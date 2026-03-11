import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, X, AlertCircle } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

function Bookings() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed" | "cancelled">("all");

  const {
    data: bookings,
    isLoading,
    isError,
  } = useQuery<Booking[]>({
    queryKey: ["bookings", projectId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/projects/${projectId}/bookings?${params}`);
      if (!res.ok) throw new Error("Failed to fetch bookings");
      return res.json();
    },
  });

  const cancelBooking = useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/bookings/${bookingId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) },
      );
      if (!res.ok) throw new Error("Failed to cancel booking");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", projectId] });
    },
  });

  function formatDateTime(isoStr: string, tz: string) {
    const date = new Date(isoStr);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    }) + " at " + date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Bookings</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            View and manage booking requests from your visitors.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(["all", "confirmed", "cancelled"] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors capitalize",
              statusFilter === filter
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="bg-destructive/10 text-destructive rounded-xl p-4 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4" />
          Failed to load bookings. Please try again.
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && bookings && bookings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Calendar className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {statusFilter === "all" ? "No bookings yet." : `No ${statusFilter} bookings.`}
          </p>
        </div>
      )}

      {/* Bookings List */}
      {bookings && bookings.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Table Header */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_120px_80px] gap-4 px-5 py-3 border-b border-border text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            <span>Visitor</span>
            <span>Date & Time</span>
            <span>Status</span>
            <span />
          </div>

          {bookings.map((booking) => (
            <div
              key={booking.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px_80px] gap-2 sm:gap-4 items-center px-5 py-4 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
            >
              {/* Visitor */}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">
                  {booking.visitorName}
                </p>
                <p className="text-[12px] text-muted-foreground truncate">
                  {booking.visitorEmail}
                  {booking.visitorPhone && ` · ${booking.visitorPhone}`}
                </p>
                {booking.notes && (
                  <p className="text-[12px] text-muted-foreground/70 truncate mt-0.5">
                    {booking.notes}
                  </p>
                )}
              </div>

              {/* Date & Time */}
              <div className="text-[13px] text-foreground">
                {formatDateTime(booking.startTime, booking.timezone)}
                <span className="text-[11px] text-muted-foreground ml-1">
                  ({booking.timezone.split("/").pop()?.replace("_", " ")})
                </span>
              </div>

              {/* Status */}
              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full border w-fit capitalize",
                  booking.status === "confirmed"
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/25"
                    : "bg-muted text-muted-foreground border-border",
                )}
              >
                {booking.status}
              </span>

              {/* Actions */}
              <div className="flex justify-end">
                {booking.status === "confirmed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                    onClick={() => cancelBooking.mutate(booking.id)}
                    disabled={cancelBooking.isPending}
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Bookings;
