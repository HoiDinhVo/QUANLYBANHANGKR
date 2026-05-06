import { prisma } from '@/lib/prisma';

// One-shot endpoint: tạo InventoryLog Type='sale' cho mọi OrderItem thuộc
// session đã thanh toán (Status='completed') mà chưa có log tương ứng.
//
// Idempotent: chạy lại không tạo trùng vì Id = `SALE-{orderItemId}` là unique.
// Dùng Invoice.CreatedAt làm timestamp log (thời điểm decrement thực tế).
//
// Cách chạy: POST tới /api/admin/backfill-sale-logs (truyền storeId nếu muốn
// chỉ backfill 1 cửa hàng, bỏ qua để chạy tất cả).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const storeId: string | undefined = body?.storeId;

    const completedSessions = await prisma.roomSession.findMany({
      where: {
        Status: 'completed',
        ...(storeId ? { StoreId: storeId } : {}),
      },
      include: {
        OrderItems: true,
        Invoice: { select: { CreatedAt: true } },
      },
    });

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const session of completedSessions) {
      // Mốc thời gian: dùng Invoice.CreatedAt nếu có (đúng với thời điểm trừ
      // kho), fallback về RoomSession.StartTime.
      const stamp = session.Invoice?.CreatedAt ?? session.StartTime;

      for (const item of session.OrderItems) {
        const logId = `SALE-${item.Id}`;

        const existing = await (prisma as any).inventoryLog.findUnique({
          where: { Id: logId },
        });
        if (existing) {
          skipped++;
          continue;
        }

        try {
          await (prisma as any).inventoryLog.create({
            data: {
              Id: logId,
              ProductId: item.ProductId,
              StoreId: session.StoreId,
              Quantity: -item.Quantity,
              Type: 'sale',
              Note: `Backfill: bán phòng ${session.RoomId}`,
              CreatedAt: stamp,
            },
          });
          created++;
        } catch (e: any) {
          // Sản phẩm đã bị xóa khỏi DB → FK fail. Bỏ qua, ghi lỗi để admin
          // biết có item nào không backfill được.
          errors.push(`OrderItem ${item.Id} (Product ${item.ProductId}): ${e?.message || 'unknown'}`);
        }
      }
    }

    return Response.json({
      success: true,
      sessionsScanned: completedSessions.length,
      created,
      skipped,
      errorsCount: errors.length,
      errors: errors.slice(0, 20), // chỉ trả 20 lỗi đầu để response không phình
    });
  } catch (error: any) {
    console.error('Backfill error:', error);
    return Response.json(
      { error: error?.message || 'Server error' },
      { status: 500 },
    );
  }
}
