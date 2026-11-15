import { Component, DestroyRef, HostListener, OnInit, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { Comic, PagedResponse } from '../comic';
import { ComicService } from '../comic.service';
import { AuthService } from '../auth.service';
import { CartService } from '../cart.service';
import { LogService } from '../log.service';
import { UserService } from '../user.service';
import { ConfigService } from '../config.service';
import { DashboardNavService } from '../dashboard-nav.service';
import { Cart } from '../cart';
import { User } from '../user';
import { Subscription } from 'rxjs';
import { DocType } from '../comic.enums';

@Component({
    selector: 'app-selling-board',
    templateUrl: './selling-board.component.html',
    styleUrls: ['./selling-board.component.css'],
    standalone: false
})
export class SellingBoardComponent implements OnInit, OnDestroy {

  pageItems: Comic[] = [];
  expandedComicId: number | null = null;

  private _expandAll = false;
  get expandAll() { return this._expandAll; }
  set expandAll(v: boolean) {
    this._expandAll = v;
    if (!v) this.expandedComicId = null;
    this.savePrefs();
  }
  totalCount = 0;
  totalPages = 0;
  currentPage = 1;

  claimedMap: Record<string, string> = {};
  myCart: Cart | null = null;
  claimError: string = '';
  loading = true;

  awardingComic: Comic | null = null;
  approvedUsers: User[] = [];
  selectedUserId: string | null = null;
  awardLoading = false;
  awardError = '';

  pendingDeleteId: number | null = null;
  deletingId: number | null = null;
  claimingSetId: number | null = null;
  copyingId: number | null = null;
  copiedId: number | null = null;

  readonly Math = Math;
  private static readonly PREFS_KEY = 'dashboard_prefs';

  private _sortOrder = 'oldest-first';
  get sortOrder() { return this._sortOrder; }
  set sortOrder(v: string) { this._sortOrder = v; this.currentPage = 1; this.loadPage(); this.savePrefs(); }

  isFilterActive = false;
  private filterItems: Comic[] = [];
  private filterSub: Subscription | null = null;

  private loadSub: Subscription | null = null;
  private loadRetryTimer: any = null;
  private destroyRef = inject(DestroyRef);

  get displayComics(): Comic[] {
    if (this.isFilterActive) {
      return this.applySortOrder([...this.filterItems]);
    }
    // pageItems are already sorted server-side; only claimed-first needs a client-side pass
    if (this.sortOrder === 'claimed-first') {
      return [...this.pageItems].sort((a, b) => {
        const aClaimed = !!this.claimedDate(a.id) ? 1 : 0;
        const bClaimed = !!this.claimedDate(b.id) ? 1 : 0;
        return bClaimed - aClaimed;
      });
    }
    return this.pageItems;
  }

  // Price for a SET container is the sum of its members; standalone comics use salePrice directly.
  private effectivePrice(comic: Comic): number {
    if (comic.docType === DocType.SET) {
      return (comic.items ?? []).reduce((sum, m) => sum + (m.salePrice ?? 0), 0);
    }
    return comic.salePrice ?? 0;
  }

  /**
   * Mirrors the server's date sort (ComicService.comparatorFor): order by createdTs, comics
   * still missing it last, and ties keep their existing order — Array.sort is stable.
   */
  private sortByCreated(comics: Comic[], dir: 'asc' | 'desc'): Comic[] {
    return comics.sort((a, b) => {
      if (a.createdTs == null && b.createdTs == null) return 0;
      if (a.createdTs == null) return 1;
      if (b.createdTs == null) return -1;
      return dir === 'asc' ? a.createdTs - b.createdTs : b.createdTs - a.createdTs;
    });
  }

  private applySortOrder(comics: Comic[]): Comic[] {
    switch (this.sortOrder) {
      case 'newest-first':
        return this.sortByCreated(comics, 'desc');
      case 'oldest-first':
        return this.sortByCreated(comics, 'asc');
      case 'a-z':
        return comics.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
      case 'z-a':
        return comics.sort((a, b) => (b.title ?? '').localeCompare(a.title ?? ''));
      case 'highest-price':
        return comics.sort((a, b) => this.effectivePrice(b) - this.effectivePrice(a));
      case 'lowest-price':
        return comics.sort((a, b) => {
          const pa = this.effectivePrice(a) || Infinity;
          const pb = this.effectivePrice(b) || Infinity;
          return pa - pb;
        });
      case 'claimed-first':
        return comics.sort((a, b) => {
          const aClaimed = !!this.claimedDate(a.id) ? 1 : 0;
          const bClaimed = !!this.claimedDate(b.id) ? 1 : 0;
          return bClaimed - aClaimed;
        });
      default:
        return comics;
    }
  }

  constructor(
    private comicService: ComicService,
    public auth: AuthService,
    private cartService: CartService,
    private logService: LogService,
    private userService: UserService,
    public configService: ConfigService,
    private navService: DashboardNavService,
    private title: Title,
    private meta: Meta,
  ) {}

  private savePrefs(): void {
    localStorage.setItem(SellingBoardComponent.PREFS_KEY, JSON.stringify({
      sortOrder: this._sortOrder,
      currentPage: this.currentPage,
      expandAll: this._expandAll,
    }));
  }

  private restorePrefs(): void {
    try {
      const raw = localStorage.getItem(SellingBoardComponent.PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.sortOrder) this._sortOrder = prefs.sortOrder;
      if (prefs.currentPage) this.currentPage = prefs.currentPage;
      if (prefs.expandAll != null) this._expandAll = prefs.expandAll;
    } catch { /* ignore corrupt data */ }
  }

  ngOnInit(): void {
    this.title.setTitle('Selling — Lightning Comics Rocks!');
    this.meta.updateTag({ name: 'description', content: 'Browse graded and raw comics available for claim. CGC, CBCS, and raw books from Golden Age to Modern. Anytown, ST.' });
    this.restorePrefs();
    this.loadPage();
    this.loadClaimedMap();
    if (this.auth.isApproved()) {
      this.cartService.getMyCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: cart => this.myCart = cart, error: () => {} });
    }
    this.logService.newClaimEvent$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(n => {
        if (n.eventType === 'RETURN') {
          delete this.claimedMap[n.comicId];
        } else {
          this.claimedMap[n.comicId] = n.claimedAt;
        }
      });
  }

  ngOnDestroy(): void {
    if (this.loadRetryTimer) clearTimeout(this.loadRetryTimer);
    if (this.loadSub) this.loadSub.unsubscribe();
    if (this.filterSub) this.filterSub.unsubscribe();
  }

  loadPage(): void {
    // Cancel any stalled in-flight request and its retry timer before starting fresh
    if (this.loadSub) { this.loadSub.unsubscribe(); this.loadSub = null; }
    if (this.loadRetryTimer) { clearTimeout(this.loadRetryTimer); this.loadRetryTimer = null; }

    this.loading = true;

    this.loadSub = this.comicService.getDashboardPage(
      this.currentPage, this.sortOrder
    ).subscribe({
      next: (response: PagedResponse<Comic>) => {
        this.loadSub = null;
        if (this.loadRetryTimer) { clearTimeout(this.loadRetryTimer); this.loadRetryTimer = null; }
        this.pageItems = response.items;
        this.totalCount = response.totalCount;
        this.totalPages = response.totalPages;
        this.loading = false;
        this.navService.setList(this.pageItems);
      },
      error: () => {
        this.loadSub = null;
        if (this.loadRetryTimer) { clearTimeout(this.loadRetryTimer); this.loadRetryTimer = null; }
        this.loading = false;
      }
    });

    // If still loading after 10 seconds, the request likely stalled — cancel and retry
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = null;
      if (this.loading) { this.loadPage(); }
    }, 10000);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    this.savePrefs();
    this.loadPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  applyFilter(term: string): void {
    if (this.filterSub) { this.filterSub.unsubscribe(); this.filterSub = null; }
    this.loading = true;
    this.isFilterActive = true;
    this.filterSub = this.comicService.searchComics(term).subscribe({
      next: (comics) => {
        this.filterItems = comics.filter(c => !c.collectionGroup || c.docType === DocType.SET);
        this.navService.setList(this.filterItems);
        this.loading = false;
      },
      error: () => {
        this.filterItems = [];
        this.loading = false;
      }
    });
  }

  clearFilter(): void {
    if (this.filterSub) { this.filterSub.unsubscribe(); this.filterSub = null; }
    this.isFilterActive = false;
    this.filterItems = [];
    this.loadPage();
  }

  loadClaimedMap(): void {
    this.cartService.getClaimedMap().subscribe({
      next: map => this.claimedMap = map,
      error: () => {}
    });
  }

  private refreshMyCart(): void {
    this.cartService.getMyCart().subscribe({ next: cart => this.myCart = cart, error: () => {} });
  }

  private handleClaimError(err: any): void {
    this.refreshMyCart();
    this.loadClaimedMap();
  }

  claim(comic: Comic): void {
    this.claimError = '';
    if (comic.docType === DocType.SET) {
      this.claimSet(comic);
      return;
    }
    this.cartService.addItem(String(comic.id)).subscribe({
      next: cart => {
        this.myCart = cart;
        this.claimedMap[String(comic.id)] = new Date().toISOString();
      },
      error: (err) => { this.handleClaimError(err); }
    });
  }

  claimSet(container: Comic): void {
    this.claimingSetId = container.id;
    this.cartService.addSet(String(container.id)).subscribe({
      next: cart => {
        this.myCart = cart;
        const members = container.items ?? [];
        this.claimedMap[String(container.id)] = new Date().toISOString();
        for (const m of members) {
          this.claimedMap[String(m.id)] = new Date().toISOString();
        }
        this.claimingSetId = null;
        this.loadPage();
      },
      error: (err) => {
        this.claimingSetId = null;
        this.handleClaimError(err);
      }
    });
  }

  isInMyCart(comicId: number): boolean {
    return this.myCart?.items.some(i => i.comicId === String(comicId)) ?? false;
  }

  isClaimedByOther(comicId: number): boolean {
    return !!this.claimedMap[String(comicId)] && !this.isInMyCart(comicId);
  }

  showClaimButton(comic: Comic): boolean {
    return !!comic.isForSale &&
           !!comic.salePrice &&
           !this.isInMyCart(comic.id) &&
           !this.isClaimedByOther(comic.id);
  }

  canClaim(comic: Comic): boolean {
    return this.showClaimButton(comic) &&
           (this.myCart?.status === 'OPEN' || !this.myCart);
  }

  cartLockedTitle(): string {
    const status = this.myCart?.status;
    if (status === 'SUBMITTED') return 'Your order has been submitted — wait for fulfillment before claiming again.';
    return '';
  }

  claimedDate(comicId: number): string | null {
    return this.claimedMap[String(comicId)] ?? null;
  }

  openAwardModal(comic: Comic): void {
    this.awardingComic = comic;
    this.selectedUserId = null;
    this.awardError = '';
    if (this.approvedUsers.length === 0) {
      this.userService.getApprovedUsers().subscribe({
        next: users => this.approvedUsers = users.filter(u => !u.isAdmin),
        error: () => this.awardError = 'Failed to load users.'
      });
    }
  }

  closeAwardModal(): void {
    this.awardingComic = null;
    this.selectedUserId = null;
    this.awardError = '';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.awardingComic) this.closeAwardModal();
  }

  isSetInMyCart(container: Comic): boolean {
    const members = container.items ?? [];
    return this.isInMyCart(container.id) || members.some(m => this.isInMyCart(m.id));
  }

  isSetClaimedByOther(container: Comic): boolean {
    const members = container.items ?? [];
    return this.isClaimedByOther(container.id) || members.some(m => this.isClaimedByOther(m.id));
  }

  showClaimSetButton(container: Comic): boolean {
    const members = container.items ?? [];
    return !!container.isForSale &&
           members.length > 0 &&
           !this.isSetInMyCart(container) &&
           !this.isSetClaimedByOther(container);
  }

  canClaimSet(container: Comic): boolean {
    return this.showClaimSetButton(container) &&
           (this.myCart?.status === 'OPEN' || !this.myCart);
  }

  confirmAward(): void {
    if (!this.awardingComic || !this.selectedUserId) return;
    const user = this.approvedUsers.find(u => u.id === this.selectedUserId);
    if (!user) return;
    this.awardLoading = true;
    this.awardError = '';
    const comic = this.awardingComic;
    this.cartService.awardComic(String(comic.id), user.id).subscribe({
      next: () => {
        this.claimedMap[String(comic.id)] = new Date().toISOString();
        this.awardLoading = false;
        this.awardingComic = null;
        this.selectedUserId = null;
      },
      error: (err) => {
        this.awardError = err?.error || 'Award failed.';
        this.awardLoading = false;
      }
    });
  }

  deleteComic(comic: Comic, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.pendingDeleteId !== comic.id) {
      this.pendingDeleteId = comic.id;
      return;
    }
    this.pendingDeleteId = null;
    this.deletingId = comic.id;
    this.comicService.deleteComic(comic.id).subscribe({
      next: () => {
        this.deletingId = null;
        this.loadPage();
      },
      error: () => { this.deletingId = null; }
    });
  }

  copyComic(comic: Comic): void {
    this.copyingId = comic.id;
    const copy: Comic = {
      ...comic,
      id: -1,
      title: comic.title + ' (Copied)',
      dateSold: null,
      soldTo: null,
      sold: null,
      items: undefined,
      defects: null,
      variant: null,
      smallCachedImageId: null,
      largeCachedImageId: null,
      smallBackImageId: null,
      largeBackImageId: null,
      comicCondition: null,
      salePrice: null,
      viewCount: null,
      ebayListingUrl: null,
    };
    this.comicService.addComic(copy).subscribe({
      next: () => {
        this.copyingId = null;
        this.copiedId = comic.id;
        setTimeout(() => { this.copiedId = null; this.loadPage(); }, 2000);
      },
      error: () => { this.copyingId = null; }
    });
  }

  markForSale(comic: Comic): void {
    const updated: Comic = { ...comic, isForSale: true };
    this.comicService.updateComic(updated).subscribe({
      next: () => {
        const idx = this.pageItems.findIndex(c => c.id === comic.id);
        if (idx >= 0) this.pageItems[idx] = { ...this.pageItems[idx], isForSale: true };
      },
      error: () => {}
    });
  }

  trackById(_index: number, comic: Comic): number { return comic.id; }
}
