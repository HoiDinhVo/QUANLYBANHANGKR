import { prisma } from '@/lib/prisma';

// Việc trừ kho + đóng phiên + giải phóng phòng đã được xử lý trong
// POST /api/invoices (cùng transaction với việc tạo hóa đơn).
// Endpoint này chỉ giữ lại để tương thích ngược, idempotent set status.
export async function POST(request: Request) {
  try {
    const { roomId, invoiceId } = await request.json();

    if (roomId) {
      await prisma.room.update({
        where: { Id: roomId },
        data: { Status: 'empty' },
      });
    }

    if (invoiceId) {
      await prisma.invoice.update({
        where: { Id: invoiceId },
        data: { Status: 'paid' },
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error completing room:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
