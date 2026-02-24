import { type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  bookingConfig,
  availabilityRules,
  bookings,
  type BookingConfigRow,
  type AvailabilityRuleRow,
  type BookingRow,
} from "../db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeSlot {
  startTime: string; // ISO 8601 UTC
  endTime: string; // ISO 8601 UTC
  startTimeLocal: string; // HH:mm in visitor timezone
  endTimeLocal: string; // HH:mm in visitor timezone
  available: boolean;
}

interface BookingConfigInput {
  enabled?: boolean;
  timezone?: string;
  slotDuration?: number;
  bufferTime?: number;
  bookingWindowDays?: number;
  minAdvanceHours?: number;
}

interface AvailabilityRuleInput {
  dayOfWeek: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

interface CreateBookingInput {
  projectId: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone?: string;
  notes?: string;
  startTime: string; // ISO 8601 UTC
  timezone: string;
  conversationId?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class BookingService {
  constructor(private db: DrizzleD1Database<Record<string, unknown>>) {}

  // ─── Booking Config ───────────────────────────────────────────────────────

  async getBookingConfig(
    projectId: string,
  ): Promise<BookingConfigRow | null> {
    const rows = await this.db
      .select()
      .from(bookingConfig)
      .where(eq(bookingConfig.projectId, projectId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertBookingConfig(
    projectId: string,
    data: BookingConfigInput,
  ): Promise<BookingConfigRow> {
    const existing = await this.getBookingConfig(projectId);

    if (existing) {
      await this.db
        .update(bookingConfig)
        .set(data)
        .where(eq(bookingConfig.projectId, projectId));
      return (await this.getBookingConfig(projectId))!;
    }

    const id = crypto.randomUUID();
    await this.db.insert(bookingConfig).values({
      id,
      projectId,
      ...data,
    });
    return (await this.getBookingConfig(projectId))!;
  }

  // ─── Availability Rules ───────────────────────────────────────────────────

  async getAvailabilityRules(
    projectId: string,
  ): Promise<AvailabilityRuleRow[]> {
    return this.db
      .select()
      .from(availabilityRules)
      .where(eq(availabilityRules.projectId, projectId))
      .orderBy(availabilityRules.dayOfWeek, availabilityRules.startTime);
  }

  async setAvailabilityRules(
    projectId: string,
    rules: AvailabilityRuleInput[],
  ): Promise<AvailabilityRuleRow[]> {
    // Delete all existing rules for this project
    await this.db
      .delete(availabilityRules)
      .where(eq(availabilityRules.projectId, projectId));

    // Insert new rules
    if (rules.length > 0) {
      const values = rules.map((rule) => ({
        id: crypto.randomUUID(),
        projectId,
        dayOfWeek: rule.dayOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
      }));
      await this.db.insert(availabilityRules).values(values);
    }

    return this.getAvailabilityRules(projectId);
  }

  // ─── Available Slots ──────────────────────────────────────────────────────

  /**
   * Get available time slots for a specific date.
   *
   * @param projectId - The project ID
   * @param dateStr - The date in YYYY-MM-DD format (in the owner's timezone)
   * @param visitorTimezone - The visitor's IANA timezone for display formatting
   * @returns Array of time slots with availability status
   */
  async getAvailableSlots(
    projectId: string,
    dateStr: string,
    visitorTimezone: string,
  ): Promise<TimeSlot[]> {
    const config = await this.getBookingConfig(projectId);
    if (!config || !config.enabled) return [];

    // Parse the date and get the day of week in the owner's timezone
    const ownerTz = config.timezone;
    const dayOfWeek = getDayOfWeekForDate(dateStr, ownerTz);

    // Get availability rules for this day
    const rules = await this.db
      .select()
      .from(availabilityRules)
      .where(
        and(
          eq(availabilityRules.projectId, projectId),
          eq(availabilityRules.dayOfWeek, dayOfWeek),
        ),
      )
      .orderBy(availabilityRules.startTime);

    if (rules.length === 0) return [];

    // Generate all possible slots from rules
    const allSlots = generateSlotsFromRules(
      rules,
      dateStr,
      ownerTz,
      config.slotDuration,
      config.bufferTime,
    );

    if (allSlots.length === 0) return [];

    // Get existing bookings for this date range
    const dayStartUtc = allSlots[0].startUtc;
    const dayEndUtc = allSlots[allSlots.length - 1].endUtc;

    const existingBookings = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.projectId, projectId),
          eq(bookings.status, "confirmed"),
          gte(bookings.startTime, new Date(dayStartUtc)),
          lte(bookings.startTime, new Date(dayEndUtc)),
        ),
      );

    // Calculate minimum allowed booking time
    const minTime = new Date(
      Date.now() + config.minAdvanceHours * 60 * 60 * 1000,
    ).getTime();

    // Build result with availability check
    return allSlots.map((slot) => {
      const slotStartMs = new Date(slot.startUtc).getTime();
      const slotEndMs = new Date(slot.endUtc).getTime();

      // Check if slot is in the past or too soon
      if (slotStartMs < minTime) {
        return formatSlot(slot, visitorTimezone, false);
      }

      // Check for overlapping bookings (accounting for buffer time)
      const bufferMs = config.bufferTime * 60 * 1000;
      const hasConflict = existingBookings.some((booking) => {
        const bookingStartMs = new Date(booking.startTime).getTime();
        const bookingEndMs = new Date(booking.endTime).getTime();
        // Add buffer on both sides of existing booking
        const blockedStart = bookingStartMs - bufferMs;
        const blockedEnd = bookingEndMs + bufferMs;
        return slotStartMs < blockedEnd && slotEndMs > blockedStart;
      });

      return formatSlot(slot, visitorTimezone, !hasConflict);
    });
  }

  // ─── Bookings CRUD ────────────────────────────────────────────────────────

  async createBooking(input: CreateBookingInput): Promise<BookingRow> {
    const config = await this.getBookingConfig(input.projectId);
    if (!config || !config.enabled) {
      throw new Error("Booking is not enabled for this project");
    }

    const startTimeMs = new Date(input.startTime).getTime();
    const endTimeMs = startTimeMs + config.slotDuration * 60 * 1000;

    // Double-booking check: look for any overlapping confirmed bookings
    const bufferMs = config.bufferTime * 60 * 1000;
    const checkStart = new Date(startTimeMs - bufferMs);
    const checkEnd = new Date(endTimeMs + bufferMs);

    const conflicts = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.projectId, input.projectId),
          eq(bookings.status, "confirmed"),
          gte(bookings.endTime, checkStart),
          lte(bookings.startTime, checkEnd),
        ),
      );

    if (conflicts.length > 0) {
      throw new Error("This time slot is no longer available");
    }

    const id = crypto.randomUUID();
    await this.db.insert(bookings).values({
      id,
      projectId: input.projectId,
      conversationId: input.conversationId ?? null,
      visitorName: input.visitorName,
      visitorEmail: input.visitorEmail,
      visitorPhone: input.visitorPhone ?? null,
      notes: input.notes ?? null,
      startTime: new Date(startTimeMs),
      endTime: new Date(endTimeMs),
      timezone: input.timezone,
      status: "confirmed",
    });

    return (await this.getBookingById(id))!;
  }

  async getBookingById(id: string): Promise<BookingRow | null> {
    const rows = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getBookings(
    projectId: string,
    options?: { status?: string; limit?: number; offset?: number },
  ): Promise<BookingRow[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let query = this.db
      .select()
      .from(bookings)
      .where(
        options?.status
          ? and(
              eq(bookings.projectId, projectId),
              eq(bookings.status, options.status as "confirmed" | "cancelled"),
            )
          : eq(bookings.projectId, projectId),
      )
      .orderBy(bookings.startTime)
      .limit(limit)
      .offset(offset);

    return query;
  }

  async cancelBooking(
    id: string,
    projectId: string,
  ): Promise<BookingRow | null> {
    await this.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.id, id), eq(bookings.projectId, projectId)));
    return this.getBookingById(id);
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Get the day of week (0=Sunday, 6=Saturday) for a YYYY-MM-DD date
 * interpreted in the given timezone.
 */
function getDayOfWeekForDate(dateStr: string, timezone: string): number {
  // Create a date at noon in the target timezone to avoid DST edge cases
  // Use a fixed time approach: construct the date and check what day it is in the tz
  const d = new Date(`${dateStr}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone,
  });
  const weekday = formatter.format(d);
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return dayMap[weekday] ?? 0;
}

interface RawSlot {
  startUtc: string; // ISO 8601
  endUtc: string; // ISO 8601
}

/**
 * Generate time slots from availability rules for a given date.
 * All times are converted to UTC for storage/comparison.
 */
function generateSlotsFromRules(
  rules: AvailabilityRuleRow[],
  dateStr: string, // YYYY-MM-DD in owner timezone
  ownerTz: string,
  durationMinutes: number,
  _bufferMinutes: number,
): RawSlot[] {
  const slots: RawSlot[] = [];

  for (const rule of rules) {
    const [startH, startM] = rule.startTime.split(":").map(Number);
    const [endH, endM] = rule.endTime.split(":").map(Number);

    // Convert owner-local start/end to UTC timestamps
    const blockStartUtc = localToUtc(dateStr, startH, startM, ownerTz);
    const blockEndUtc = localToUtc(dateStr, endH, endM, ownerTz);

    let cursor = blockStartUtc;
    const slotMs = durationMinutes * 60 * 1000;

    while (cursor + slotMs <= blockEndUtc) {
      slots.push({
        startUtc: new Date(cursor).toISOString(),
        endUtc: new Date(cursor + slotMs).toISOString(),
      });
      // Advance by slot duration (buffer is only for booking conflict checks)
      cursor += slotMs;
    }
  }

  return slots;
}

/**
 * Convert a local time (date + hours + minutes in a timezone) to a UTC timestamp.
 */
function localToUtc(
  dateStr: string,
  hours: number,
  minutes: number,
  timezone: string,
): number {
  // Build an ISO string assuming UTC, then calculate the offset
  const pad = (n: number) => n.toString().padStart(2, "0");
  const isoStr = `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;

  // Create a date from the string (interpreted as local by the engine)
  // We need to figure out the UTC offset for this timezone at this time
  // Strategy: format the UTC date in the target timezone and compute the delta
  const utcGuess = new Date(isoStr + "Z").getTime();

  // Get what time it would be in the target timezone if it were this UTC time
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(utcGuess));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  const localAtUtcGuess = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
  ).getTime();

  // The offset is the difference between the local representation and UTC
  const offsetMs = localAtUtcGuess - utcGuess;

  // The actual UTC time for our desired local time is shifted back by this offset
  return utcGuess - offsetMs;
}

/**
 * Format a raw slot into the public TimeSlot shape with local times for the visitor.
 */
function formatSlot(
  slot: RawSlot,
  visitorTimezone: string,
  available: boolean,
): TimeSlot {
  const startDate = new Date(slot.startUtc);
  const endDate = new Date(slot.endUtc);

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: visitorTimezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return {
    startTime: slot.startUtc,
    endTime: slot.endUtc,
    startTimeLocal: timeFormatter.format(startDate),
    endTimeLocal: timeFormatter.format(endDate),
    available,
  };
}
