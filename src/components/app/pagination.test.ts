import { describe, expect, it } from "vitest";

describe("Pagination logic for Inquiries & Potential Matches", () => {
  const PAGE_SIZE = 20;

  function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;
    return {
      totalPages,
      safePage,
      pageItems: items.slice(start, start + pageSize),
      startItemIndex: items.length > 0 ? start + 1 : 0,
      endItemIndex: Math.min(start + pageSize, items.length),
    };
  }

  it("limits each page to a maximum of 20 items", () => {
    const sampleItems = Array.from({ length: 45 }, (_, i) => ({ id: `msg-${i + 1}` }));

    // Page 1
    const p1 = paginate(sampleItems, 1);
    expect(p1.totalPages).toBe(3);
    expect(p1.safePage).toBe(1);
    expect(p1.pageItems.length).toBe(20);
    expect(p1.startItemIndex).toBe(1);
    expect(p1.endItemIndex).toBe(20);
    expect(p1.pageItems[0].id).toBe("msg-1");
    expect(p1.pageItems[19].id).toBe("msg-20");

    // Page 2
    const p2 = paginate(sampleItems, 2);
    expect(p2.safePage).toBe(2);
    expect(p2.pageItems.length).toBe(20);
    expect(p2.startItemIndex).toBe(21);
    expect(p2.endItemIndex).toBe(40);
    expect(p2.pageItems[0].id).toBe("msg-21");
    expect(p2.pageItems[19].id).toBe("msg-40");

    // Page 3 (remainder)
    const p3 = paginate(sampleItems, 3);
    expect(p3.safePage).toBe(3);
    expect(p3.pageItems.length).toBe(5);
    expect(p3.startItemIndex).toBe(41);
    expect(p3.endItemIndex).toBe(45);
    expect(p3.pageItems[0].id).toBe("msg-41");
    expect(p3.pageItems[4].id).toBe("msg-45");
  });

  it("safely clamps pages when page is out of bounds", () => {
    const sampleItems = Array.from({ length: 25 }, (_, i) => ({ id: `msg-${i + 1}` }));

    // Page beyond max
    const overflow = paginate(sampleItems, 99);
    expect(overflow.totalPages).toBe(2);
    expect(overflow.safePage).toBe(2);
    expect(overflow.pageItems.length).toBe(5);

    // Negative or 0 page
    const underflow = paginate(sampleItems, 0);
    expect(underflow.safePage).toBe(1);
    expect(underflow.pageItems.length).toBe(20);
  });

  it("handles empty lists gracefully", () => {
    const empty: unknown[] = [];
    const p = paginate(empty, 1);
    expect(p.totalPages).toBe(1);
    expect(p.safePage).toBe(1);
    expect(p.pageItems.length).toBe(0);
    expect(p.startItemIndex).toBe(0);
    expect(p.endItemIndex).toBe(0);
  });
});

