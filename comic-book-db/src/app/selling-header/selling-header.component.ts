import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-selling-header',
    templateUrl: './selling-header.component.html',
    styleUrls: ['./selling-header.component.css'],
    standalone: false,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SellingHeaderComponent {
  @Input() itemCount: number = 0;
  @Input() totalCount: number = 0;
  @Input() currentPage: number = 1;
  @Input() totalPages: number = 0;
  @Input() isFilterActive: boolean = false;

  get isFiltered(): boolean {
    return this.totalPages > 1;
  }
  @Input() expandAll: boolean = false;
  @Output() expandAllChange = new EventEmitter<boolean>();
  @Input() sortOrder: string = 'oldest-first';
  @Output() sortOrderChange = new EventEmitter<string>();
  @Output() goToPage = new EventEmitter<number>();
  @Output() filterApplied = new EventEmitter<string>();
  @Output() filterCleared = new EventEmitter<void>();
}
