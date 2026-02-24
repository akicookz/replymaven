import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Clock,
  Plus,
  Trash2,
  AlertCircle,
  User,
  Mail,
  Phone,
  FileText,
  XCircle,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingConfig {
  id?: string;
  enabled: boolean;
  timezone: string;
  slotDuration: number;
  bufferTime: number;
  bookingWindowDays: number;
  minAdvanceHours: number;
}

interface AvailabilityRule {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface Booking {
  id: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string | null;
  notes: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Stockholm",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

// ─── Component ────────────────────────────────────────────────────────────────

function Bookings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"settings" | "bookings">(
    "settings",
  );

  // ── Config state ──────────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState("America/New_York");
  const [slotDuration, setSlotDuration] = useState(30);
  const [bufferTime, setBufferTime] = useState(0);
  const [hasConfigChanges, setHasConfigChanges] = useState(false);

  // ── Availability state ────────────────────────────────────────────────────
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [hasRuleChanges, setHasRuleChanges] = useState(false);

  // ── Fetch config + rules ──────────────────────────────────────────────────
  const { data: configData, isLoading: configLoading } = useQuery<{
    config: BookingConfig;
    rules: AvailabilityRule[];
  }>({
    queryKey: ["booking-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/booking/config`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // ── Fetch bookings ────────────────────────────────────────────────────────
  const { data: bookings, isLoading: bookingsLoading } = useQuery<Booking[]>({
    queryKey: ["bookings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/bookings`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // ── Sync fetched data to state ────────────────────────────────────────────
  useEffect(() => {
    if (configData) {
      setEnabled(configData.config.enabled);
      setTimezone(configData.config.timezone);
      setSlotDuration(configData.config.slotDuration);
      setBufferTime(configData.config.bufferTime);
      setRules(
        configData.rules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
        })),
      );
      setHasConfigChanges(false);
      setHasRuleChanges(false);
    }
  }, [configData]);

  // ── Save config mutation ──────────────────────────────────────────────────
  const saveConfig = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/booking/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          timezone,
          slotDuration: String(slotDuration),
          bufferTime,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["booking-config", projectId],
      });
      setHasConfigChanges(false);
    },
  });

  // ── Save availability mutation ────────────────────────────────────────────
  const saveRules = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/booking/availability`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules }),
        },
      );
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["booking-config", projectId],
      });
      setHasRuleChanges(false);
    },
  });

  // ── Cancel booking mutation ───────────────────────────────────────────────
  const cancelBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/bookings/${bookingId}`,
        { method: "PATCH" },
      );
      if (!res.ok) throw new Error("Failed to cancel");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", projectId] });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function addTimeBlock(dayOfWeek: number) {
    setRules([...rules, { dayOfWeek, startTime: "09:00", endTime: "17:00" }]);
    setHasRuleChanges(true);
  }

  function removeTimeBlock(index: number) {
    setRules(rules.filter((_, i) => i !== index));
    setHasRuleChanges(true);
  }

  function updateTimeBlock(
    index: number,
    field: "startTime" | "endTime",
    value: string,
  ) {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    setRules(updated);
    setHasRuleChanges(true);
  }

  function getRulesForDay(dayOfWeek: number) {
    return rules
      .map((r, idx) => ({ ...r, _index: idx }))
      .filter((r) => r.dayOfWeek === dayOfWeek);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (configLoading) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <div className="h-8 w-48 rounded-xl bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  const upcomingBookings = (bookings ?? []).filter(
    (b) =>
      b.status === "confirmed" &&
      new Date(b.startTime).getTime() > Date.now(),
  );
  const pastBookings = (bookings ?? []).filter(
    (b) =>
      b.status !== "confirmed" ||
      new Date(b.startTime).getTime() <= Date.now(),
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-6 h-6" />
            Bookings
          </h1>
          <p className="text-sm text-muted-foreground">
            Let visitors book time slots through the chat widget.
          </p>
        </div>
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setActiveTab("settings")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "settings"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Settings
        </button>
        <button
          onClick={() => setActiveTab("bookings")}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
            activeTab === "bookings"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Bookings
          {upcomingBookings.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs px-1.5">
              {upcomingBookings.length}
            </Badge>
          )}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SETTINGS TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          {/* ── General Config Card ────────────────────────────────────────── */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base font-semibold">
                  Enable bookings
                </Label>
                <p className="text-xs text-muted-foreground">
                  Adds a "Book a meeting" option to your chat widget
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked);
                  setHasConfigChanges(true);
                }}
              />
            </div>

            {enabled && (
              <>
                {/* Timezone */}
                <div className="space-y-2">
                  <Label>Your timezone</Label>
                  <Select
                    value={timezone}
                    onValueChange={(val) => {
                      setTimezone(val);
                      setHasConfigChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Slot Duration */}
                <div className="space-y-2">
                  <Label>Meeting duration</Label>
                  <div className="flex gap-2">
                    {[15, 30, 60].map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          setSlotDuration(d);
                          setHasConfigChanges(true);
                        }}
                        className={cn(
                          "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                          slotDuration === d
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {d} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Buffer Time */}
                <div className="space-y-2">
                  <Label>Buffer between meetings</Label>
                  <p className="text-xs text-muted-foreground">
                    Extra time between consecutive bookings
                  </p>
                  <Select
                    value={String(bufferTime)}
                    onValueChange={(val) => {
                      setBufferTime(parseInt(val));
                      setHasConfigChanges(true);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No buffer</SelectItem>
                      <SelectItem value="5">5 minutes</SelectItem>
                      <SelectItem value="10">10 minutes</SelectItem>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Save button */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={() => saveConfig.mutate()}
                disabled={!hasConfigChanges || saveConfig.isPending}
              >
                {saveConfig.isPending ? "Saving..." : "Save settings"}
              </Button>
              {saveConfig.isError && (
                <div className="flex items-center gap-1.5 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Failed to save
                </div>
              )}
            </div>
          </div>

          {/* ── Availability Card ──────────────────────────────────────────── */}
          {enabled && (
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Weekly availability
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set your available hours for each day of the week. Times are
                  in{" "}
                  <span className="font-medium">
                    {timezone.replace(/_/g, " ")}
                  </span>
                  .
                </p>
              </div>

              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
                  const dayRules = getRulesForDay(dayOfWeek);
                  return (
                    <div
                      key={dayOfWeek}
                      className="flex items-start gap-4 py-3 border-b border-border last:border-0"
                    >
                      {/* Day label */}
                      <div className="w-28 shrink-0 pt-2">
                        <span className="text-sm font-medium text-foreground">
                          {DAY_NAMES[dayOfWeek]}
                        </span>
                      </div>

                      {/* Time blocks */}
                      <div className="flex-1 space-y-2">
                        {dayRules.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">
                            Unavailable
                          </p>
                        ) : (
                          dayRules.map((rule) => (
                            <div
                              key={rule._index}
                              className="flex items-center gap-2"
                            >
                              <Input
                                type="time"
                                value={rule.startTime}
                                onChange={(e) =>
                                  updateTimeBlock(
                                    rule._index,
                                    "startTime",
                                    e.target.value,
                                  )
                                }
                                className="w-32"
                              />
                              <span className="text-muted-foreground text-sm">
                                to
                              </span>
                              <Input
                                type="time"
                                value={rule.endTime}
                                onChange={(e) =>
                                  updateTimeBlock(
                                    rule._index,
                                    "endTime",
                                    e.target.value,
                                  )
                                }
                                className="w-32"
                              />
                              <button
                                onClick={() => removeTimeBlock(rule._index)}
                                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}

                        {/* Add time block (max 4 per day) */}
                        {dayRules.length < 4 && (
                          <button
                            onClick={() => addTimeBlock(dayOfWeek)}
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors py-1"
                          >
                            <Plus className="w-3 h-3" />
                            Add time block
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Save button */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={() => saveRules.mutate()}
                  disabled={!hasRuleChanges || saveRules.isPending}
                >
                  {saveRules.isPending ? "Saving..." : "Save availability"}
                </Button>
                {saveRules.isError && (
                  <div className="flex items-center gap-1.5 text-destructive text-xs">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Failed to save
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* BOOKINGS TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "bookings" && (
        <div className="space-y-6">
          {bookingsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : !bookings || bookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <CalendarDays className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-1">
                No bookings yet
              </h2>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                When visitors book meetings through your widget, they'll appear
                here. Make sure bookings are enabled and you've set your
                availability.
              </p>
            </div>
          ) : (
            <>
              {/* Upcoming */}
              {upcomingBookings.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Upcoming ({upcomingBookings.length})
                  </h3>
                  {upcomingBookings.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      onCancel={() => cancelBooking.mutate(booking.id)}
                      cancelling={cancelBooking.isPending}
                    />
                  ))}
                </div>
              )}

              {/* Past / Cancelled */}
              {pastBookings.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Past & Cancelled ({pastBookings.length})
                  </h3>
                  {pastBookings.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      past
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Booking Card Component ───────────────────────────────────────────────────

function BookingCard({
  booking,
  onCancel,
  cancelling,
  past,
}: {
  booking: Booking;
  onCancel?: () => void;
  cancelling?: boolean;
  past?: boolean;
}) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);

  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = `${start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} - ${end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })}`;

  return (
    <div
      className={cn(
        "px-5 py-4 bg-card rounded-xl border border-border",
        past && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          {/* Date and time */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CalendarClock className="w-4 h-4 text-primary" />
              {dateStr}
            </div>
            <span className="text-sm text-muted-foreground">{timeStr}</span>
            <Badge
              variant={booking.status === "confirmed" ? "default" : "secondary"}
              className="text-[11px]"
            >
              {booking.status}
            </Badge>
          </div>

          {/* Visitor info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {booking.visitorName}
            </span>
            <span className="flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              {booking.visitorEmail}
            </span>
            {booking.visitorPhone && (
              <span className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" />
                {booking.visitorPhone}
              </span>
            )}
          </div>

          {/* Notes */}
          {booking.notes && (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{booking.notes}</span>
            </div>
          )}
        </div>

        {/* Cancel button */}
        {!past && booking.status === "confirmed" && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
            className="text-muted-foreground hover:text-destructive shrink-0"
          >
            <XCircle className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default Bookings;
