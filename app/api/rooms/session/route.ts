import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const { roomId, storeId } = await request.json();

    // Check if room exists and is empty
    const room = await prisma.room.findUnique({
      where: { Id: roomId },
    });

    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    if (room.Status !== 'empty') {
      return Response.json({ error: 'Room is not available' }, { status: 400 });
    }

    // Create room session
    const session = await prisma.roomSession.create({
      data: {
        Id: Date.now().toString(),
        RoomId: roomId,
        StoreId: storeId,
        StartTime: new Date(),
        Status: 'pending', // Mặc định là pending để nhân viên có thể order trước mà chưa tính tiền giờ
      },
    });

    // Update room status to occupied
    await prisma.room.update({
      where: { Id: roomId },
      data: { Status: 'occupied' },
    });

    return Response.json({
      id: session.Id,
      roomId: session.RoomId,
      storeId: session.StoreId,
      startTime: session.StartTime,
      status: session.Status,
    });
  } catch (error) {
    console.error('Error creating room session:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
      return Response.json({ error: 'roomId is required' }, { status: 400 });
    }

    // Lấy session mới nhất của phòng (bao gồm cả trạng thái đang chờ hoặc đang hát)
    const session = await prisma.roomSession.findFirst({
      where: {
        RoomId: roomId,
        Status: { in: ['active', 'pending', 'paused'] },
      },
      orderBy: {
        StartTime: 'desc',      // ưu tiên session mới nhất
      },
    });

    const headers = {
      // Cache ngắn 10s. Status có thể đổi (active/paused/cancelled) nhưng
      // các thay đổi đều đi qua client của user đang xem nên acceptable.
      'Cache-Control': 's-maxage=10, stale-while-revalidate=60',
    };

    if (session) {
      return Response.json(
        {
          id: session.Id,
          roomId: session.RoomId,
          storeId: session.StoreId,
          startTime: session.StartTime,
          status: session.Status,
          updatedAt: session.UpdatedAt,
          customerName: session.CustomerName ?? 'Khách lẻ',
          endTime: session.EndTime,
        },
        { headers },
      );
    }

    return Response.json(null, { headers });
  } catch (error) {
    console.error('Error fetching room session:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, startTime, StartTime, status, Status, customerName, CustomerName, endTime, EndTime } = body;

    if (!id) {
      return Response.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const updateData: any = {};

    // XỬ LÝ HỦY PHÒNG
    // - Stock chỉ bị decrement khi thanh toán (tạo Invoice trong /api/invoices).
    //   Nên session chưa thanh toán = stock chưa giảm = KHÔNG hoàn kho.
    // - Nếu session đã có Invoice = đã thanh toán = không cho hủy
    //   (việc hủy đơn đã thanh toán phải đi qua quy trình refund riêng).
    // - Giữ nguyên OrderItems để báo cáo lịch sử có thể truy vết được;
    //   inventory route đã loại sessions cancelled qua filter Status.
    const newStatus = status || Status;
    if (newStatus === 'cancelled') {
      const existingInvoice = await prisma.invoice.findUnique({
        where: { RoomSessionId: id },
        select: { Id: true },
      });
      if (existingInvoice) {
        return Response.json(
          { error: 'Không thể hủy phiên đã thanh toán' },
          { status: 400 }
        );
      }
    }

    // Cập nhật thời gian bắt đầu (startTime / StartTime)
    const startVal = startTime !== undefined ? startTime : StartTime;
    if (startVal !== undefined && startVal !== null) {
      updateData.StartTime = new Date(startVal);
    }

    // Cập nhật giờ kết thúc (dự kiến) - Cho phép null để xóa giờ thủ công
    if (endTime !== undefined || EndTime !== undefined) {
      const val = endTime !== undefined ? endTime : EndTime;
      updateData.EndTime = val ? new Date(val) : null;
    }

    // Cập nhật trạng thái nếu có
    if (status || Status) {
      updateData.Status = status || Status;
    }

    // ✅ THÊM: Cập nhật tên khách hàng nếu có
    if (customerName !== undefined || CustomerName !== undefined) {
      const nameValue = customerName !== undefined ? customerName : CustomerName;
      updateData.CustomerName = nameValue || 'Khách lẻ';
    }

    const session = await prisma.roomSession.update({
      where: { Id: id },
      data: updateData,
    });

    return Response.json({
      id: session.Id,
      roomId: session.RoomId,
      storeId: session.StoreId,
      startTime: session.StartTime,
      status: session.Status,
      updatedAt: session.UpdatedAt,
      customerName: session.CustomerName, // ✅ THÊM: trả về tên khách hàng
      endTime: session.EndTime,
    });
  } catch (error) {
    console.error('Error updating room session:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
