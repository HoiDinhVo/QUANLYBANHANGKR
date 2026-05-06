import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId');

    const rooms = await prisma.room.findMany({
      where: storeId ? { StoreId: storeId } : {},
    });

    const formatted = (rooms as any[]).map((r) => ({
      id: r.Id,
      storeId: r.StoreId,
      roomNumber: r.RoomNumber,
      capacity: r.Capacity,
      status: r.Status,
      pricePerHour: Number(r.PricePerHour),
      createdAt: r.CreatedAt,
    }));

    return Response.json(formatted, {
      headers: {
        // Edge cache 10s + stale-while-revalidate 60s.
        // Status phòng đổi sau mỗi mutation (POST/PUT/DELETE) — chấp nhận
        // staleness tối đa 10s đổi lại tiết kiệm phần lớn function invocations.
        'Cache-Control': 's-maxage=10, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { storeId, roomNumber, capacity, pricePerHour } = await request.json();
    console.log('Creating room:', { storeId, roomNumber, capacity, pricePerHour });

    const room = await prisma.room.create({
      data: {
        Id: Date.now().toString(),
        StoreId: storeId,
        RoomNumber: roomNumber,
        Capacity: Number(capacity) || 0,
        Status: 'empty',
        PricePerHour: Number(pricePerHour) || 0,
      },
    });

    console.log('Room created:', room);

    return Response.json({
      id: room.Id,
      storeId: room.StoreId,
      roomNumber: room.RoomNumber,
      capacity: room.Capacity,
      status: room.Status,
      pricePerHour: Number(room.PricePerHour),
    });
  } catch (error) {
    console.error('Error creating room:', error);
    return Response.json({ error: 'Server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
export async function PUT(request: Request) {
  try {
    const { id, roomNumber, capacity, pricePerHour, status } = await request.json();

    const updateData: any = {
      RoomNumber: roomNumber,
      Capacity: Number(capacity) || 0,
      PricePerHour: Number(pricePerHour) || 0,
    };

    if (status !== undefined) {
      updateData.Status = status;
    }

    const updated = await prisma.room.update({
      where: { Id: id },
      data: updateData,
    });

    return Response.json({
      id: updated.Id,
      roomNumber: updated.RoomNumber,
      capacity: updated.Capacity,
      status: updated.Status,
      pricePerHour: Number(updated.PricePerHour),
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Update failed' }, { status: 500 });
  }
}

// ❌ DELETE
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    await prisma.room.delete({
      where: { Id: id },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Delete failed' }, { status: 500 });
  }
}