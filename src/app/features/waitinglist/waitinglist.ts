import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WaitingListItem, WaitingStatus, WaitingListService } from '../../service/waitinglist-service';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-waitinglist',
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './waitinglist.html',
  styleUrl: './waitinglist.css',
})
export class Waitinglist implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  items: WaitingListItem[] = [];
  filteredItems: WaitingListItem[] = [];
  paginatedItems: WaitingListItem[] = [];

  isLoadingData = true;
  errorMsg = '';

  currentPage = 1;
  pageSize = 6;
  totalPages = 1;

  searchQuery = '';
  selectedStatusFilter: WaitingStatus | '' = '';

  showDetailsModal = false;
  selectedItem: WaitingListItem | null = null;
  newStatusIndex = 0;

  statusOptions: { label: string; value: number }[] = [];
  filterOptions: { label: string; value: WaitingStatus | '' }[] = [];

  showConvertModal = false;
  convertItem: WaitingListItem | null = null;

  toast: { show: boolean; success: boolean; message: string } = {
    show: false, success: true, message: '',
  };
  toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private svc: WaitingListService,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService,
  ) {}

  ngOnInit(): void {
    this.rebuildTranslatedLists();
    this.translate.onLangChange
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.rebuildTranslatedLists();
        this.cdr.markForCheck();
      });
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  private rebuildTranslatedLists(): void {
    const t = (k: string) => this.translate.instant(k);
    this.filterOptions = [
      { label: t('features.waitinglist.filterAll'), value: '' },
      { label: t('features.waitinglist.statPending'), value: 'Pending' },
      { label: t('features.waitinglist.statContacted'), value: 'Contacted' },
      { label: t('features.waitinglist.statBooked'), value: 'Booked' },
      { label: t('features.waitinglist.statCancelled'), value: 'Cancelled' },
    ];
    this.statusOptions = [
      { label: t('features.waitinglist.statPending'), value: 0 },
      { label: t('features.waitinglist.statContacted'), value: 1 },
      { label: t('features.waitinglist.statBooked'), value: 2 },
      { label: t('features.waitinglist.statCancelled'), value: 3 },
    ];
  }

  loadData(): void {
    this.isLoadingData = true;
    this.errorMsg = '';
    this.svc.getAll()
      .pipe(finalize(() => {
        this.isLoadingData = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (data) => {
          this.items = data;
          this.applyFilters();
        },
        error: () => {
          this.errorMsg = this.translate.instant('features.waitinglist.loadError');
        },
      });
  }

  applyFilters(): void {
    let result = [...this.items];
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.customerName.toLowerCase().includes(q) ||
          i.phone.includes(q) ||
          i.chaletName.toLowerCase().includes(q),
      );
    }
    if (this.selectedStatusFilter) {
      result = result.filter((i) => i.status === this.selectedStatusFilter);
    }
    result = result.sort((a, b) => +new Date(b.date) - +new Date(a.date));
    this.filteredItems = result;
    this.totalPages = Math.max(1, Math.ceil(result.length / this.pageSize));
    if (this.currentPage > this.totalPages) this.currentPage = 1;
    this.paginate();
  }

  paginate(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    this.paginatedItems = this.filteredItems.slice(start, start + this.pageSize);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.paginate();
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }

  onSearchChange(): void { this.currentPage = 1; this.applyFilters(); }
  onFilterChange(): void { this.currentPage = 1; this.applyFilters(); }

  openDetails(item: WaitingListItem): void {
    this.selectedItem = { ...item };
    const statusKeys: WaitingStatus[] = ['Pending', 'Contacted', 'Booked', 'Cancelled'];
    const idx = statusKeys.indexOf(item.status);
    this.newStatusIndex = idx >= 0 ? idx : 0;
    this.showDetailsModal = true;
  }

  closeDetailsModal(): void {
    this.showDetailsModal = false;
    this.selectedItem = null;
  }

  saveStatus(): void {
    if (!this.selectedItem) return;

    const itemId = this.selectedItem.id;
    const statusIndex = this.newStatusIndex;
    const statusKeys: WaitingStatus[] = ['Pending', 'Contacted', 'Booked', 'Cancelled'];

    this.closeDetailsModal();
    this.cdr.detectChanges();

    this.svc.updateStatus(itemId, statusIndex)
      .pipe(finalize(() => this.cdr.detectChanges()))
      .subscribe({
        next: (res) => {
          const idx = this.items.findIndex((i) => i.id === itemId);
          if (idx > -1) {
            this.items[idx] = { ...this.items[idx], status: statusKeys[statusIndex] };
          }
          this.applyFilters();
          const text =
            (typeof res === 'string' ? res : null) ??
            (res as { message?: string })?.message ??
            this.translate.instant('features.waitinglist.updatedOk');
          this.showToast(true, text);
        },
        error: (err) => {
          const errMsg =
            err?.error?.message ||
            err?.error?.title ||
            err?.message ||
            this.translate.instant('features.waitinglist.updateError');
          this.showToast(false, errMsg);
        },
      });
  }

  openConvert(item: WaitingListItem, event: Event): void {
    event.stopPropagation();
    this.convertItem = item;
    this.showConvertModal = true;
  }

  closeConvertModal(): void {
    this.showConvertModal = false;
    this.convertItem = null;
  }

  confirmConvert(): void {
    if (!this.convertItem) return;

    const itemId = this.convertItem.id;

    this.closeConvertModal();
    this.cdr.detectChanges();

    this.svc.convertToBooking(itemId)
      .pipe(finalize(() => this.cdr.detectChanges()))
      .subscribe({
        next: (res) => {
          const msg = res?.message;
          const success = msg?.success ?? false;
          const text = msg?.message ??
            (success
              ? this.translate.instant('features.waitinglist.convertOk')
              : this.translate.instant('features.waitinglist.convertFail'));

          this.showToast(success, text);

          if (success) {
            const idx = this.items.findIndex((i) => i.id === itemId);
            if (idx > -1) {
              this.items[idx] = { ...this.items[idx], status: 'Booked' };
            }
            this.applyFilters();
          }
        },
        error: (err) => {
          const body = err?.error;
          if (body?.message?.message) {
            this.showToast(false, body.message.message);
          } else {
            const errMsg =
              err?.error?.title ||
              err?.message ||
              this.translate.instant('features.waitinglist.convertError');
            this.showToast(false, errMsg);
          }
        },
      });
  }

  showToast(success: boolean, message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { show: true, success, message };
    this.cdr.detectChanges();
    this.toastTimer = setTimeout(() => {
      this.toast.show = false;
      this.cdr.detectChanges();
    }, 4500);
  }

  statusClass(status: WaitingStatus): string {
    const map: Record<WaitingStatus, string> = {
      Pending: 'badge-pending',
      Contacted: 'badge-contacted',
      Booked: 'badge-booked',
      Cancelled: 'badge-cancelled',
    };
    return map[status] ?? '';
  }

  getWaitingStatusLabel(status: WaitingStatus): string {
    return this.translate.instant(`features.waitinglist.stat${status}` as string);
  }

  periodLabel(period: string): string {
    const p = period === 'Evening' ? 'Evening' : 'Morning';
    return this.translate.instant(`period.${p}`);
  }

  private dateLocale(): string {
    const lang = this.translate.currentLang || 'ar';
    if (lang === 'ar') return 'ar-EG';
    if (lang === 'fr') return 'fr-FR';
    return 'en-US';
  }

  timeAgo(dateStr: string | null | undefined): string {
    if (!dateStr) return '—';

    const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '—';

    const t = (k: string, params?: object) => this.translate.instant(k, params);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMs < 0) return t('misc.agoNow');
    if (diffMin < 1) return t('misc.agoNow');
    if (diffMin === 1) return t('misc.agoOneMinute');
    if (diffMin < 60) return t('misc.agoMinutes', { n: diffMin });
    if (diffHr === 1) return t('misc.agoOneHour');
    if (diffHr < 24) return t('misc.agoHours', { n: diffHr });
    if (diffDay === 1) return t('misc.agoOneDay');
    if (diffDay < 7) return t('misc.agoDays', { n: diffDay });
    if (diffDay < 30) return t('misc.agoWeeks', { n: Math.floor(diffDay / 7) });
    if (diffDay < 365) return t('misc.agoMonths', { n: Math.floor(diffDay / 30) });
    return t('misc.agoYears', { n: Math.floor(diffDay / 365) });
  }

  getTimeAgoClass(dateStr: string | null | undefined): string {
    if (!dateStr) return '';

    const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';

    const diffHr = (Date.now() - date.getTime()) / 3_600_000;

    if (diffHr < 1) return 'time-fresh';
    if (diffHr < 3) return 'time-medium';
    if (diffHr < 24) return 'time-old';
    return 'time-urgent';
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString(this.dateLocale(), {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  formatDateTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '';

    const normalized = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat(this.dateLocale(), {
      timeZone: 'Asia/Amman',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  openWhatsApp(phone: string | null | undefined): void {
    if (!phone) return;
    const clean = phone.replace(/\D/g, '');
    window.open(`https://wa.me/${clean}`, '_blank');
  }

showMcNotes(notes: any): boolean {
  if (!notes) return false;
  const str = String(notes).trim();
  return str.length > 0 && str !== 'لا يوجد ملاحظات';
}

  get pendingCount(): number { return this.items.filter((i) => i.status === 'Pending').length; }
  get contactedCount(): number { return this.items.filter((i) => i.status === 'Contacted').length; }
  get bookedCount(): number { return this.items.filter((i) => i.status === 'Booked').length; }
  get cancelledCount(): number { return this.items.filter((i) => i.status === 'Cancelled').length; }
}
