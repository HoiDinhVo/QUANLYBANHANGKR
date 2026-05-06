import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { roomSessionId, startTime: requestStartTime, endTime: requestEndTime, customerName, roomCost: requestRoomCost, totalPrice: requestTotalPrice } = await request.json();

    // Get room session with room and store details
    const session = await prisma.roomSession.findUnique({
      where: { Id: roomSessionId },
      include: { Room: true },
    });

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const room = session.Room;
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    // Get order items
    const items = await prisma.orderItem.findMany({
      where: { RoomSessionId: roomSessionId },
    });

    const startTime = requestStartTime ? new Date(requestStartTime) : session.StartTime;
    const endTime = requestEndTime ? new Date(requestEndTime) : new Date();

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return Response.json({ error: 'Invalid start or end time' }, { status: 400 });
    }

    if (endTime.getTime() <= startTime.getTime()) {
      return Response.json({ error: 'End time must be after start time' }, { status: 400 });
    }

    const durationMinutes = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60));
    const fallbackRoomCost = Math.ceil((durationMinutes * Number(room.PricePerHour)) / 60);
    const requestedRoomCost = Number(requestRoomCost);
    const roomCost = !isNaN(requestedRoomCost) ? requestedRoomCost : fallbackRoomCost;

    // Calculate items cost
    const itemsCost = items.reduce((total, item) => total + Number(item.Price) * item.Quantity, 0);
    const subtotal = roomCost + itemsCost;
    const requestedTotalPrice = Number(requestTotalPrice);
    const totalPrice = !isNaN(requestedTotalPrice) ? requestedTotalPrice : Math.ceil(subtotal / 1000) * 1000;

    // Thực hiện trong transaction để đảm bảo tính nhất quán dữ liệu
    // (tạo hóa đơn + trừ kho + đóng phiên + giải phóng phòng phải đồng nhất)
    const invoice = await prisma.$transaction(async (tx) => {
      // 1. Kiểm tra & trừ kho cho từng OrderItem + ghi InventoryLog Type='sale'
      //    - updateMany với where Quantity >= x: atomic, chống race + chống âm.
      //    - InventoryLog: tạo audit trail đầy đủ, là source of truth cho báo cáo
      //      kho. Id = `SALE-{orderItemId}` để chống ghi trùng và truy vết được.
      for (const item of items) {
        const updated = await tx.product.updateMany({
          where: { Id: item.ProductId, Quantity: { gte: item.Quantity } },
          data: { Quantity: { decrement: item.Quantity } },
        });
        if (updated.count === 0) {
          throw new Error(`Sản phẩm "${item.ProductName}" không đủ tồn kho`);
        }

        await (tx as any).inventoryLog.create({
          data: {
            Id: `SALE-${item.Id}`,
            ProductId: item.ProductId,
            StoreId: session.StoreId,
            Quantity: -item.Quantity,
            Type: 'sale',
            Note: `Bán phòng ${session.RoomId}`,
          },
        });
      }

      // 2. Tạo hóa đơn (RoomSessionId là @unique trong schema → ngăn tạo trùng,
      //    nếu user lỡ bấm "Thanh toán" 2 lần thì lần thứ 2 sẽ throw, transaction
      //    tự rollback phần trừ kho ở trên).
      const created = await tx.invoice.create({
        data: {
          Id: Date.now().toString(),
          RoomSessionId: roomSessionId,
          CustomerName: customerName || 'Khách lẻ',
          StoreId: session.StoreId,
          RoomId: session.RoomId,
          StartTime: startTime,
          EndTime: endTime,
          RoomCost: roomCost,
          TotalPrice: totalPrice,
          Status: 'paid',
        },
      });

      // 3. Cập nhật trạng thái session
      await tx.roomSession.update({
        where: { Id: roomSessionId },
        data: { Status: 'completed' },
      });

      // 4. Đưa phòng về trạng thái trống
      await tx.room.update({
        where: { Id: session.RoomId },
        data: { Status: 'empty' },
      });

      return created;
    });

    // Return invoice with items for display
    return Response.json({
      ...invoice,
      items: items.map(item => ({
        id: item.Id,
        roomSessionId: item.RoomSessionId,
        productId: item.ProductId,
        productName: item.ProductName,
        price: Number(item.Price),
        quantity: item.Quantity,
        orderedAt: item.OrderedAt,
      })),
    });
  } catch (error: any) {
    console.error('Invoice creation error:', error);
    const msg = typeof error?.message === 'string' ? error.message : '';
    if (msg.includes('không đủ tồn kho')) {
      return Response.json({ error: msg }, { status: 400 });
    }
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId');
    const id = searchParams.get('id');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    const invoices = await prisma.invoice.findMany({
      where: id ? { Id: id } : {
        ...(storeId ? { StoreId: storeId } : {}),
        ...(includeDeleted ? {} : { DeletedAt: null }),
      },
      include: {
        RoomSession: {
          include: {
            OrderItems: true,
            Room: true,
          },
        },
      },
      orderBy: { CreatedAt: 'desc' },
    });

    // Transform to match the expected format
    const transformedInvoices = invoices.map(invoice => ({
      id: invoice.Id,
      roomSessionId: invoice.RoomSessionId,
      customerName: invoice.CustomerName,
      storeId: invoice.StoreId,
      roomId: invoice.RoomId,
      roomNumber: (invoice.RoomSession?.Room as any)?.RoomNumber || (invoice.RoomSession?.Room as any)?.roomNumber || '',
      startTime: invoice.StartTime,
      endTime: invoice.EndTime,
      roomCost: Number(invoice.RoomCost),
      totalPrice: Number(invoice.TotalPrice),
      status: invoice.Status,
      createdAt: invoice.CreatedAt,
      updatedAt: invoice.UpdatedAt,
      // Thêm kiểm tra an toàn ở đây để tránh crash API
      items: (invoice.RoomSession?.OrderItems || []).map(item => ({
        id: item.Id,
        roomSessionId: item.RoomSessionId,
        productId: item.ProductId,
        productName: item.ProductName,
        price: Number(item.Price),
        quantity: item.Quantity,
        orderedAt: item.OrderedAt,
      })),
    }));

    // Lịch sử hóa đơn 30s staleness là acceptable.
    const headers = {
      'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
    };

    // Nếu yêu cầu theo ID đơn lẻ, trả về object thay vì mảng
    if (id && transformedInvoices.length > 0) {
      return Response.json(transformedInvoices[0], { headers });
    }

    return Response.json(transformedInvoices, { headers });
  } catch (error) {
    console.error('Invoice fetch error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}


export async function DELETE(request: NextRequest) {
  try {
    const { id, all, storeId, permanent } = await request.json();
    const now = new Date();

    if (all) {
      if (permanent) {
        await prisma.invoice.deleteMany({
          where: storeId && storeId !== 'all' ? { StoreId: storeId } : {}
        });
      } else {
        await prisma.invoice.updateMany({
          where: {
            ...(storeId && storeId !== 'all' ? { StoreId: storeId } : {}),
            DeletedAt: null
          },
          data: { DeletedAt: now }
        });
      }
      return Response.json({ success: true });
    }

    if (!id) {
      return Response.json({ error: 'ID hóa đơn là bắt buộc' }, { status: 400 });
    }

    if (permanent) {
      await prisma.invoice.delete({ where: { Id: id } });
    } else {
      await prisma.invoice.update({
        where: { Id: id },
        data: { DeletedAt: now }
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Invoice delete error:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
