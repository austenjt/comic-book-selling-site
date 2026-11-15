package org.example.functions.service;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.example.functions.model.ComicBook;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Unit tests for the two pieces that keep dashboard ordering stable across edits:
 * {@link ComicService#hydrateCreatedTs} and {@link ComicService#comparatorFor}. Both are static
 * and touch no Cosmos state, so they exercise directly.
 *
 * <p>The motivation is that {@code _ts} is Cosmos's last-modified timestamp, so sorting by it
 * moved a comic to a different page every time an admin saved it. {@code createdTs} replaces it
 * and is backfilled lazily — which means the sort has to cope with a collection where only some
 * documents carry the field yet.</p>
 */
class ComicServiceSortTest {

    private static ComicBook comic(int id, Long createdTs) {
        ComicBook c = new ComicBook();
        c.setId(id);
        c.setCreatedTs(createdTs);
        return c;
    }

    private static List<Integer> idsAfterSort(List<ComicBook> comics, String sort) {
        List<ComicBook> copy = new ArrayList<>(comics);
        copy.sort(ComicService.comparatorFor(sort));
        return copy.stream().map(ComicBook::getId).collect(Collectors.toList());
    }

    // ─── hydrateCreatedTs ────────────────────────────────────────────────────

    @Test
    void hydrateFillsCreatedTsFromTsWhenAbsent() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("_ts", 1700000000L);

        ComicService.hydrateCreatedTs(node);

        assertEquals(1700000000L, node.get("createdTs").asLong());
    }

    @Test
    void hydrateFillsCreatedTsWhenPresentButNull() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.putNull("createdTs");
        node.put("_ts", 1700000000L);

        ComicService.hydrateCreatedTs(node);

        assertEquals(1700000000L, node.get("createdTs").asLong());
    }

    /** Once a document has been healed, a later save must not re-stamp it with the new _ts. */
    @Test
    void hydrateLeavesAnExistingCreatedTsAlone() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        node.put("createdTs", 1600000000L);
        node.put("_ts", 1700000000L); // document was edited since it was created

        ComicService.hydrateCreatedTs(node);

        assertEquals(1600000000L, node.get("createdTs").asLong());
    }

    @Test
    void hydrateIsANoOpWhenNeitherFieldIsPresent() {
        ObjectNode node = JsonNodeFactory.instance.objectNode();

        ComicService.hydrateCreatedTs(node);

        assertNull(node.get("createdTs"));
    }

    // ─── comparatorFor: date sorts ───────────────────────────────────────────

    @Test
    void oldestFirstOrdersAscendingByCreatedTs() {
        List<ComicBook> comics = List.of(comic(3, 300L), comic(1, 100L), comic(2, 200L));

        assertEquals(List.of(1, 2, 3), idsAfterSort(comics, "oldest-first"));
    }

    @Test
    void newestFirstOrdersDescendingByCreatedTs() {
        List<ComicBook> comics = List.of(comic(3, 300L), comic(1, 100L), comic(2, 200L));

        assertEquals(List.of(3, 2, 1), idsAfterSort(comics, "newest-first"));
    }

    @Test
    void nullSortIsTreatedAsOldestFirst() {
        List<ComicBook> comics = List.of(comic(2, 200L), comic(1, 100L));

        assertEquals(List.of(1, 2), idsAfterSort(comics, null));
    }

    @Test
    void claimedFirstOrdersAscendingSoTheFrontendCanReSort() {
        List<ComicBook> comics = List.of(comic(2, 200L), comic(1, 100L));

        assertEquals(List.of(1, 2), idsAfterSort(comics, "claimed-first"));
    }

    // ─── comparatorFor: partially backfilled collections ─────────────────────

    /** A comic with no createdTs must still appear — that omission is the bug being fixed. */
    @Test
    void comicsMissingCreatedTsSortLastInBothDirections() {
        List<ComicBook> comics = List.of(comic(9, null), comic(2, 200L), comic(1, 100L));

        assertEquals(List.of(1, 2, 9), idsAfterSort(comics, "oldest-first"));
        assertEquals(List.of(2, 1, 9), idsAfterSort(comics, "newest-first"));
    }

    @Test
    void comicsMissingCreatedTsKeepDatabaseOrderAmongThemselves() {
        List<ComicBook> comics = List.of(comic(7, null), comic(8, null), comic(1, 100L));

        assertEquals(List.of(1, 7, 8), idsAfterSort(comics, "oldest-first"));
    }

    /** A CSV import stamps a whole batch with one epoch second; the batch must not scramble. */
    @Test
    void comicsSharingOneTimestampKeepDatabaseOrder() {
        List<ComicBook> comics = List.of(comic(5, 200L), comic(6, 200L), comic(7, 200L), comic(1, 100L));

        assertEquals(List.of(1, 5, 6, 7), idsAfterSort(comics, "oldest-first"));
    }

    /** Healed and un-healed comics interleave by value rather than clumping into two blocks. */
    @Test
    void storedAndHydratedValuesInterleave() {
        // 150 and 350 are hydrated from _ts; 100 and 300 were persisted earlier
        List<ComicBook> comics = List.of(comic(4, 350L), comic(1, 100L), comic(3, 300L), comic(2, 150L));

        assertEquals(List.of(1, 2, 3, 4), idsAfterSort(comics, "oldest-first"));
    }
}
