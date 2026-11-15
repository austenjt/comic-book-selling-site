import { Component, EventEmitter, Output } from '@angular/core';

@Component({
    selector: 'app-comic-search',
    templateUrl: './comic-search.component.html',
    styleUrls: ['./comic-search.component.css'],
    standalone: false
})
export class ComicSearchComponent {
  filterTerm = '';
  isApplied = false;

  @Output() filterApplied = new EventEmitter<string>();
  @Output() filterCleared = new EventEmitter<void>();

  applyFilter(): void {
    const term = this.filterTerm.trim();
    if (!term) return;
    this.isApplied = true;
    this.filterApplied.emit(term);
  }

  clearFilter(): void {
    this.filterTerm = '';
    this.isApplied = false;
    this.filterCleared.emit();
  }
}
