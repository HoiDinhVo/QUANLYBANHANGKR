import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Vietnam timezone offset: UTC+7
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Convert a "YYYY-MM-DD" string to a Date representing
 * the start of that calendar day in Vietnam time (UTC+7).
 */
function vnDayStart(dateStr: string): Date {
    // "2025-05-01" → 2025-05-01T00:00:00+07:00 → UTC 2025-04-30T17:00:00Z
    return new Date(new Date(dateStr + 'T00:00:00+07:00').getTime());
}

function vnDayEnd(dateStr: string): Date {
    return new Date(new Date(dateStr + 'T23:59:59.999+07:00').getTime());
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('storeId');
    const type = searchParams.get('type') || 'daily';
    const startParam = searchParams.get('startDate'); // "YYYY-MM-DD"
    const endParam   = searchParams.get('endDate');   // "YYYY-MM-DD"

    if (!storeId) {
        return NextResponse.json({ error: 'Missing storeId' }, { status: 400 });
    }

    try {
        /* ─────────────────────────────────────────────────────── */
        /* 1. BUILD TIME RANGE (all times in UTC, VN-aware)        */
        /* ─────────────────────────────────────────────────────── */

        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        if (startParam) {
            // Custom date range from UI – treat as VN calendar days
            startDate = vnDayStart(startParam);
            endDate   = endParam ? vnDayEnd(endParam) : now;
        } else {
            // Quick-select periods – compute in VN local time
            // Get "now" as VN wall-clock components
            const vnNow = new Date(now.getTime() + VN_OFFSET_MS);
            const y  = vnNow.getUTCFullYear();
            const m  = vnNow.getUTCMonth();     // 0-based
            const d  = vnNow.getUTCDate();
            const wd = vnNow.getUTCDay();       // 0=Sun

            if (type === 'daily') {
                // Today 00:00 → 23:59 VN
                startDate = new Date(Date.UTC(y, m, d) - VN_OFFSET_MS);
                endDate   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - VN_OFFSET_MS);
            } else if (type === 'weekly') {
                // Monday → Sunday of current week
                const diffToMon = wd === 0 ? -6 : 1 - wd;
                startDate = new Date(Date.UTC(y, m, d + diffToMon) - VN_OFFSET_MS);
                endDate   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - VN_OFFSET_MS);
            } else if (type === 'monthly') {
                startDate = new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS);
                endDate   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - VN_OFFSET_MS);
            } else if (type === 'yearly') {
                startDate = new Date(Date.UTC(y, 0, 1) - VN_OFFSET_MS);
                endDate   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - VN_OFFSET_MS);
            } else {
                // fallback = daily
                startDate = new Date(Date.UTC(y, m, d) - VN_OFFSET_MS);
                endDate   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - VN_OFFSET_MS);
            }
        }

        /* ─────────────────────────────────────────────────────── */
        /* 2. PRODUCTS                                              */
        /* ─────────────────────────────────────────────────────── */

        const products = await prisma.product.findMany({
            where: { StoreId: storeId },
        });

        /* ─────────────────────────────────────────────────────── */
        /* 3. INVENTORY LOGS IN PERIOD                             */
        /*    (InventoryLog là source of truth duy nhất)           */
        /* ─────────────────────────────────────────────────────── */

        // Tất cả "nhập kho" trong kỳ: log với Quantity > 0 (restock + nhập đầu)
        const restocksInPeriod = await (prisma as any).inventoryLog.groupBy({
            by: ['ProductId'],
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate, lte: endDate },
                Quantity: { gt: 0 },
            },
            _sum: { Quantity: true },
        });

        // Bán trong phòng (Type='sale') — tách riêng để hiển thị + tính revenue
        const salesInPeriod = await (prisma as any).inventoryLog.groupBy({
            by: ['ProductId'],
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate, lte: endDate },
                Type: 'sale',
            },
            _sum: { Quantity: true },
        });

        // Xuất khác (mang về, tặng, điều chỉnh giảm) — log Quantity<0 không phải sale
        const exportsInPeriod = await (prisma as any).inventoryLog.groupBy({
            by: ['ProductId'],
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate, lte: endDate },
                Quantity: { lt: 0 },
                Type: { not: 'sale' },
            },
            _sum: { Quantity: true },
        });

        /* ─────────────────────────────────────────────────────── */
        /* 4. ACTIVITY FROM startDate → NOW (for opening stock)    */
        /*                                                         */
        /* Opening stock formula (đơn giản, dựa hoàn toàn vào log):*/
        /*   openingStock = currentStock (DB)                      */
        /*                  + abs(decrements từ startDate đến NOW) */
        /*                  - increments từ startDate đến NOW      */
        /*                                                         */
        /* Đảo ngược toàn bộ activity (qua log) từ startDate tới   */
        /* hiện tại để có stock tại thời điểm đầu kỳ.              */
        /* ─────────────────────────────────────────────────────── */

        const incrementsSinceStart = await (prisma as any).inventoryLog.groupBy({
            by: ['ProductId'],
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate },
                Quantity: { gt: 0 },
            },
            _sum: { Quantity: true },
        });

        const decrementsSinceStart = await (prisma as any).inventoryLog.groupBy({
            by: ['ProductId'],
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate },
                Quantity: { lt: 0 },
            },
            _sum: { Quantity: true },
        });

        /* ─────────────────────────────────────────────────────── */
        /* 7. LOG LIST (for history tab)                           */
        /* ─────────────────────────────────────────────────────── */

        const logs = await (prisma as any).inventoryLog.findMany({
            where: {
                StoreId: storeId,
                CreatedAt: { gte: startDate, lte: endDate },
            },
            include: { product: true },
            orderBy: { CreatedAt: 'desc' },
        });

        /* ─────────────────────────────────────────────────────── */
        /* 8. CALCULATE PER-PRODUCT STATS                          */
        /* ─────────────────────────────────────────────────────── */

        const safe = (n: any) => Number(n || 0);

        const stats = products.map(p => {
            // ── In-period numbers (đều đọc từ InventoryLog) ────
            const salePeriod   = salesInPeriod.find((s: any) => s.ProductId === p.Id);
            const roomSales    = Math.abs(safe(salePeriod?._sum?.Quantity)); // log sale âm

            const exportPeriod = exportsInPeriod.find((e: any) => e.ProductId === p.Id);
            const exported     = Math.abs(safe(exportPeriod?._sum?.Quantity));

            const restockPeriod   = restocksInPeriod.find((r: any) => r.ProductId === p.Id);
            const totalRestocked  = safe(restockPeriod?._sum?.Quantity);

            // ── Opening stock ──────────────────────────────────
            // Đảo ngược toàn bộ activity từ startDate tới NOW dựa hoàn toàn
            // vào InventoryLog (single source of truth):
            //   openingStock = currentStock
            //                + abs(decrements từ startDate đến NOW)
            //                - increments từ startDate đến NOW
            const incRec   = incrementsSinceStart.find((i: any) => i.ProductId === p.Id);
            const totalIncSinceStart = safe(incRec?._sum?.Quantity);

            const decRec   = decrementsSinceStart.find((d: any) => d.ProductId === p.Id);
            const totalDecSinceStart = Math.abs(safe(decRec?._sum?.Quantity));

            const openingStock =
                p.Quantity
                + totalDecSinceStart   // cộng lại mọi thứ đã trừ kể từ startDate
                - totalIncSinceStart;  // trừ đi mọi thứ đã nhập kể từ startDate

            // ── Closing stock ──────────────────────────────────
            const totalDecrement = roomSales + exported;
            const closingStock   = openingStock + totalRestocked - totalDecrement;

            return {
                productId:      p.Id,
                productName:    p.Name,
                category:       p.Category,
                openingStock:   Math.max(0, openingStock),
                totalRestocked,
                totalSold:      roomSales,
                totalExported:  exported,
                totalDecrement,
                totalRevenue:   roomSales * Number(p.Price || 0),  // bán phòng × giá hiện tại
                currentStock:   p.Quantity,
                closingStock:   Math.max(0, closingStock),
            };
        });

        /* ─────────────────────────────────────────────────────── */
        /* 9. RESPONSE                                             */
        /* ─────────────────────────────────────────────────────── */

        return NextResponse.json(
            {
                stats,
                logs: logs.map((l: any) => ({
                    id:          l.Id,
                    productName: l.product?.Name || 'Sản phẩm đã xóa',
                    quantity:    l.Quantity,
                    createdAt:   l.CreatedAt,
                    type:        l.Type,
                    note:        l.Note,
                })),
                period: {
                    startDate: startDate.toISOString(),
                    endDate:   endDate.toISOString(),
                    type,
                },
            },
            {
                headers: {
                    // Báo cáo: 6 groupBy + 2 findMany — đắt CPU. Cache 30s đủ
                    // tươi, mỗi storeId/type/range là cache key riêng.
                    'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
                },
            },
        );

    } catch (error) {
        console.error('Inventory Stats API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}