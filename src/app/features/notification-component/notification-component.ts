import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AppNotification, NotificationService } from '../../service/NotificationService';
import { JordanDatePipe } from '../../adds/pipes/jordan-date-pipe';

@Component({
  selector: 'app-notification-component',
  imports: [CommonModule],
  templateUrl: './notification-component.html',
  styleUrl: './notification-component.css',
})
export class NotificationComponent implements OnInit, OnDestroy {
  notifications: AppNotification[] = [];
  unreadCount = 0;
  isOpen = false;
 
  private subs: Subscription[] = [];
 
  constructor(private notifService: NotificationService) {}
 
  ngOnInit(): void {
    this.subs.push(
      this.notifService.notifications$.subscribe(n => {
        this.notifications = n;
      }),
      this.notifService.unreadCount$.subscribe(c => {
        this.unreadCount = c;
      })
    );
  }
 
  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }
 
  closeDropdown(): void {
    this.isOpen = false;
  }
 
  onNotifClick(n: AppNotification): void {
    if (n.bookingId) {
      this.notifService.navigateToBooking(n);
      this.closeDropdown();
    } else if (!n.isRead) {
      this.notifService.markAsRead(n.id).subscribe();
      this.notifService.markAsReadLocally(n.id);
    }
  }
 
  markAllRead(): void {
    this.notifService.markAllAsRead();
  }
 
  refresh(): void {
    this.notifService.loadNotifications();
  }
 
formatTime(dateStr: string): string {
  if (!dateStr) return '';

  // جرب الاتنين — مع Z ومن غيرها
  let date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  if (isNaN(date.getTime())) date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const diffMs  = Date.now() - date.getTime();
  const diffMin = Math.floor(Math.abs(diffMs) / 60000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMs < 0 || diffMin < 1) return 'الآن';
  if (diffMin === 1)  return 'منذ دقيقة';
  if (diffMin < 60)  return `منذ ${diffMin} دقيقة`;
  if (diffHr  === 1) return 'منذ ساعة';
  if (diffHr  < 24)  return `منذ ${diffHr} ساعة`;
  if (diffDay === 1) return 'أمس';
  if (diffDay < 7)   return `منذ ${diffDay} أيام`;

  return date.toLocaleDateString('ar-EG', {
    timeZone: 'Asia/Amman',
    day: 'numeric',
    month: 'short'
  });
}
  // إغلاق بـ Escape
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeDropdown();
  }
 
  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }
}
 