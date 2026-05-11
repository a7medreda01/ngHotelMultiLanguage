import {
  ChangeDetectorRef, Component, EventEmitter,
  Input, OnChanges, OnInit, Output, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BookingService, Bookings, UpcomingBooking,
  normalizeChaletType, normalizePeriod
} from '../../service/booking-service';
import { ChaletService, Chalet } from '../../service/chalet-service';
import { forkJoin } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewBookingRequest {
  chaletType: number;
  period: number;
  date: string;
}

export interface DayCell {
  date: Date;
  dateStr: string;       // YYYY-MM-DD
  isCurrentMonth: boolean;
  isPast: boolean;
  isToday: boolean;
  slots: SlotSummary[];
  totalChalets: number;
  totalConfirmed: number;
  totalPending: number;
  totalAvailable: number;
  status: 'empty' | 'available' | 'partial' | 'pending' | 'full';
}

export interface SlotSummary {
  chaletType: number;       // 0=عادي, 1=رويال
  period: number;           // 0=صباحي, 1=مسائي, 2=كامل
  totalChalets: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  available: number;
  bookings: UpcomingBooking[];
}

export interface DayDetail {
  dateStr: string;
  slots: SlotDetailItem[];
}

export interface SlotDetailItem extends SlotSummary {
  bookingsList: Bookings[];
  loadingBookings: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-booking-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './booking-overview.html',
  styleUrl: './booking-overview.css',
})
export class BookingOverviewComponent implements OnInit, OnChanges {

  @Input() allBookings: Bookings[] = [];
  @Output() newBookingRequested    = new EventEmitter<NewBookingRequest>();
  @Output() bookingDetailRequested = new EventEmitter<number>(); // bookingId

  // ─── State ────────────────────────────────────────────────────────────────
  showModal = false;
  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();

  weeks: DayCell[][] = [];
  upcomingBookings: UpcomingBooking[] = [];
  chalets: Chalet[] = [];

  // counts per type/period
  chaletCountMap: Record<string, number> = {};

  // detail panel
  selectedDay: DayCell | null = null;
  dayDetail: DayDetail | null = null;
  loadingDetail = false;

  // expanded slot (to show bookings list)
  expandedSlotKey = '';

  loading = true;

  constructor(
    private bookingService: BookingService,
    private chaletService: ChaletService,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService
  ) {}

  get dayNames(): string[] {
    return [0, 1, 2, 3, 4, 5, 6].map(i => this.translate.instant(`weekdaysShort.${i}`));
  }

  getPeriodLabel(period: number): string {
    const keys: Record<number, string> = {
      0: 'misc.overviewPeriodMorning',
      1: 'misc.overviewPeriodEvening',
      2: 'misc.overviewPeriodFull',
    };
    return this.translate.instant(keys[period] ?? keys[0]);
  }

  ngOnInit(): void {
    this.loadData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['allBookings'] && !changes['allBookings'].firstChange) {
      this.buildCalendar();
    }
  }

open(): void {
  this.showModal = true;

  // reset state
  this.selectedDay = null;
  this.dayDetail = null;
  this.expandedSlotKey = '';

  // refresh latest data every open
  this.loadData();

  this.cdr.detectChanges();
}

  close(): void {
    this.showModal = false;
    this.selectedDay = null;
    this.dayDetail = null;
  }

  // ─── Data Loading ─────────────────────────────────────────────────────────

  loadData(): void {
    this.loading = true;
    forkJoin({
      upcoming: this.bookingService.getUpcomingBookings(),
      chalets:  this.chaletService.getAll(),
    }).subscribe({
      next: ({ upcoming, chalets }) => {
        this.upcomingBookings = upcoming?.data ?? [];
        this.chalets = chalets;
        this.buildChaletCountMap();
        this.buildCalendar();
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.buildCalendar();
        this.cdr.detectChanges();
      }
    });
  }

  buildChaletCountMap(): void {
    this.chaletCountMap = {};
    // For each type/period combo, count chalets that support it
    // We'll query separately or derive from chalets list
    // Use a heuristic: count from upcoming + loaded chalets
    // We'll call getChaletsByTypePeriod for all combos
    const combos = [
      [0,0],[0,1],[0,2],[1,0],[1,1],[1,2]
    ];
    combos.forEach(([type, period]) => {
      this.bookingService.getChaletsByTypePeriod(type, period).subscribe({
        next: list => {
          this.chaletCountMap[`${type}_${period}`] = list.length;
          this.buildCalendar();
          this.cdr.detectChanges();
        },
        error: () => {
          this.chaletCountMap[`${type}_${period}`] = 0;
        }
      });
    });
  }

  // ─── Calendar Building ────────────────────────────────────────────────────

  buildCalendar(): void {
    const year  = this.currentYear;
    const month = this.currentMonth;
    const today = new Date(); today.setHours(0,0,0,0);

    // All bookings source: combine upcomingBookings + allBookings
    const allSource = this.mergeBookingSources();

    // first day of month
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    // pad start (Sunday = 0)
    const startPad = firstDay.getDay();
    const cells: DayCell[] = [];

    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push(this.buildDayCell(d, false, today, allSource));
    }

    // Current month days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      cells.push(this.buildDayCell(date, true, today, allSource));
    }

    // Next month padding to complete last row
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      cells.push(this.buildDayCell(d, false, today, allSource));
    }

    // Split into weeks
    this.weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      this.weeks.push(cells.slice(i, i + 7));
    }

    this.cdr.detectChanges();
  }

  private mergeBookingSources(): any[] {
    const map = new Map<number, any>();
    for (const b of this.allBookings) map.set(b.id, b);
    for (const b of this.upcomingBookings) {
      if (!map.has(b.id)) map.set(b.id, b);
    }
    return Array.from(map.values());
  }

  private buildDayCell(
    date: Date,
    isCurrentMonth: boolean,
    today: Date,
    allSource: any[]
  ): DayCell {
    const dateStr = this.fmt(date);
    const isPast  = date < today;
    const isToday = date.getTime() === today.getTime();

    // Filter bookings for this date
    const dayBookings = allSource.filter(b =>
      b.status !== 'Cancelled' && this.parseDate(b.date) === dateStr
    );

    // Build slot summaries for each type/period combo that has chalets
    const slots: SlotSummary[] = [];
    const combos: [number,number][] = [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]];

    for (const [type, period] of combos) {
      const total = this.chaletCountMap[`${type}_${period}`] ?? 0;
      if (total === 0) continue;

      const slotBookings = dayBookings.filter(b =>
        normalizeChaletType(b.chaletType) === type &&
        normalizePeriod(b.period) === period
      );

      const confirmed  = slotBookings.filter(b => b.status === 'Confirmed' || b.status === 'Done').length;
      const pending    = slotBookings.filter(b => b.status === 'Pending' || b.status === 'WaitingList').length;
      const cancelled  = slotBookings.filter(b => b.status === 'Cancelled').length;
      const available  = Math.max(0, total - confirmed - pending);

      slots.push({
        chaletType: type, period,
        totalChalets: total,
        confirmed, pending, cancelled, available,
        bookings: slotBookings
      });
    }

    const totalChalets   = slots.reduce((s, sl) => s + sl.totalChalets, 0);
    const totalConfirmed = slots.reduce((s, sl) => s + sl.confirmed, 0);
    const totalPending   = slots.reduce((s, sl) => s + sl.pending, 0);
    const totalAvailable = slots.reduce((s, sl) => s + sl.available, 0);

    let status: DayCell['status'] = 'empty';
    if (slots.length > 0) {
      if (totalAvailable === totalChalets) status = 'available';
      else if (totalAvailable === 0 && totalPending > 0) status = 'pending';
      else if (totalAvailable === 0) status = 'full';
      else status = 'partial';
    }

    return {
      date, dateStr, isCurrentMonth, isPast, isToday,
      slots, totalChalets, totalConfirmed, totalPending,
      totalAvailable, status
    };
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  prevMonth(): void {
    if (this.currentMonth === 0) { this.currentMonth = 11; this.currentYear--; }
    else this.currentMonth--;
    this.buildCalendar();
    this.selectedDay = null;
    this.dayDetail = null;
  }

  nextMonth(): void {
    if (this.currentMonth === 11) { this.currentMonth = 0; this.currentYear++; }
    else this.currentMonth++;
    this.buildCalendar();
    this.selectedDay = null;
    this.dayDetail = null;
  }

  goToToday(): void {
    this.currentYear  = new Date().getFullYear();
    this.currentMonth = new Date().getMonth();
    this.buildCalendar();
    this.selectedDay = null;
    this.dayDetail = null;
  }

  // ─── Day Selection ────────────────────────────────────────────────────────

  selectDay(day: DayCell): void {
    if (!day.isCurrentMonth) return;
    this.selectedDay = day;
    this.expandedSlotKey = '';
    this.buildDayDetail(day);
  }

  buildDayDetail(day: DayCell): void {
    this.dayDetail = {
      dateStr: day.dateStr,
      slots: day.slots.map(sl => ({
        ...sl,
        bookingsList: [],
        loadingBookings: false
      }))
    };
    this.cdr.detectChanges();
  }

  toggleSlot(slot: SlotDetailItem): void {
    const key = `${slot.chaletType}_${slot.period}`;
    if (this.expandedSlotKey === key) {
      this.expandedSlotKey = '';
      return;
    }
    this.expandedSlotKey = key;

    if (slot.bookingsList.length === 0 && (slot.confirmed + slot.pending) > 0) {
      slot.loadingBookings = true;
      this.cdr.detectChanges();

      this.bookingService.getBookingsByTypeDatePeriod(
        slot.chaletType, this.selectedDay!.dateStr, slot.period
      ).subscribe({
        next: res => {
          slot.bookingsList = (res.data ?? []).filter((b: any) => b.status !== 'Cancelled');
          slot.loadingBookings = false;
          this.cdr.detectChanges();
        },
        error: () => {
          // fallback: filter from allBookings
          slot.bookingsList = this.allBookings.filter(b =>
            normalizeChaletType(b.chaletType) === slot.chaletType &&
            normalizePeriod(b.period) === slot.period &&
            this.parseDate(b.date) === this.selectedDay!.dateStr &&
            b.status !== 'Cancelled'
          );
          slot.loadingBookings = false;
          this.cdr.detectChanges();
        }
      });
    }
  }

  isSlotExpanded(slot: SlotSummary): boolean {
    return this.expandedSlotKey === `${slot.chaletType}_${slot.period}`;
  }
refreshing = false;
refreshDay(): void {
  if (!this.selectedDay || this.refreshing) return;
  this.refreshing = true;
  this.expandedSlotKey = '';
  this.cdr.detectChanges();

  this.loadData(); // reload كامل

  setTimeout(() => {
    this.refreshing = false;
    // أعد اختيار نفس اليوم بعد الـ reload
    if (this.selectedDay) {
      const flat  = this.weeks.flat();
      const found = flat.find(d => d.dateStr === this.selectedDay!.dateStr);
      if (found) this.buildDayDetail(found);
    }
    this.cdr.detectChanges();
  }, 1200);
}
  // ─── New Booking ──────────────────────────────────────────────────────────

// غيّر الـ requestNewBooking الحالي — ابعت التاريخ حتى لو مفيش available
requestNewBooking(chaletType: number, period: number): void {
  if (!this.selectedDay) return;
  
  const date = this.selectedDay.dateStr;
  
  // أخّر الـ close عشان الـ emit يوصل للـ parent الأول
  this.newBookingRequested.emit({
    chaletType,
    period,
    date,
  });
  
  // close بعد الـ emit
  setTimeout(() => {
    this.close();
  }, 50);
}

  openBookingDetail(bookingId: number): void {
    // this.close();
    this.bookingDetailRequested.emit(bookingId);
  }

  // ─── Navigation between days ─────────────────────────────────────────────

  get prevDayCell(): DayCell | null {
    if (!this.selectedDay) return null;
    for (const week of this.weeks) {
      for (let i = 0; i < week.length; i++) {
        if (week[i].dateStr === this.selectedDay.dateStr) {
          // find previous in flat list
          const flat = this.weeks.flat();
          const idx = flat.findIndex(d => d.dateStr === this.selectedDay!.dateStr);
          return idx > 0 ? flat[idx - 1] : null;
        }
      }
    }
    return null;
  }

  get nextDayCell(): DayCell | null {
    if (!this.selectedDay) return null;
    const flat = this.weeks.flat();
    const idx = flat.findIndex(d => d.dateStr === this.selectedDay!.dateStr);
    return idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  }

  navigateDay(dir: 'prev' | 'next'): void {
    const target = dir === 'prev' ? this.prevDayCell : this.nextDayCell;
    if (!target) return;
    if (!target.isCurrentMonth) {
      if (dir === 'prev') this.prevMonth();
      else this.nextMonth();
      setTimeout(() => {
        const flat = this.weeks.flat();
        const found = flat.find(d => d.dateStr === target.dateStr);
        if (found) this.selectDay(found);
      }, 50);
      return;
    }
    this.selectDay(target);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  fmt(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  parseDate(s: string): string {
    return s ? s.split('T')[0] : '';
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m-1, d);
    const wk = this.translate.instant(`weekdays.${date.getDay()}`);
    const mo = this.translate.instant(`months.${m}`);
    return `${wk} ${d} ${mo} ${y}`;
  }

  getStatusLabel(s: string): string {
    if (!s) return '';
    const key = `status.${s}`;
    const t = this.translate.instant(key);
    return t !== key ? t : s;
  }

  getStatusClass(s: string): string {
    const map: Record<string,string> = {
      Pending: 'badge-pending', Confirmed: 'badge-confirmed',
      Cancelled: 'badge-cancelled', WaitingList: 'badge-waiting', Done: 'badge-done'
    };
    return map[s] ?? '';
  }

  get headerLabel(): string {
  return `${this.currentMonth + 1} / ${this.currentYear}`;
}

  trackByWeek(i: number, week: DayCell[]): number { return i; }
  trackByDate(i: number, cell: DayCell): string { return cell.dateStr; }
  trackBySlot(i: number, sl: SlotSummary): string { return `${sl.chaletType}_${sl.period}`; }

getMonthStat(type: 'confirmed' | 'pending' | 'available'): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells = this.weeks
    .flat()
    .filter(c => {
      const cellDate = new Date(c.date);
      cellDate.setHours(0, 0, 0, 0);

      return c.isCurrentMonth && cellDate >= today;
    });

  if (type === 'confirmed') return cells.reduce((s, c) => s + c.totalConfirmed, 0);
  if (type === 'pending')   return cells.reduce((s, c) => s + c.totalPending, 0);

  return cells.reduce((s, c) => s + c.totalAvailable, 0);
}
}