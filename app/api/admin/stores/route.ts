
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const stores = await prisma.store.findMany();

    const formatted = stores.map((s) => ({
      id: s.Id,
      name: s.Name,
      address: s.Address,
      phone: s.Phone,
      createdAt: s.CreatedAt,
    }));

    return Response.json(formatted, {
      headers: {
        // Stores rất tĩnh, hiếm khi đổi → cache lâu.
        'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, address, phone } = await request.json();

    if (!name || !address || !phone) {
      return Response.json({ error: 'Thiếu dữ liệu' }, { status: 400 });
    }

    const store = await prisma.store.create({
      data: {
        Id: Date.now().toString(),
        Name: name,
        Address: address,
        Phone: phone,
      },
    });

    return Response.json({
      id: store.Id,
      name: store.Name,
      address: store.Address,
      phone: store.Phone,
      createdAt: store.CreatedAt,
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
export async function PUT(request: Request) {
  try {
    const { id, name, address, phone } = await request.json();

    if (!id) {
      return Response.json({ error: 'Thiếu ID' }, { status: 400 });
    }

    const updated = await prisma.store.update({
      where: { Id: id },
      data: {
        Name: name,
        Address: address,
        Phone: phone,
      },
    });

    return Response.json({
      id: updated.Id,
      name: updated.Name,
      address: updated.Address,
      phone: updated.Phone,

    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Update failed' }, { status: 500 });
  }
}
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return Response.json({ error: 'Thiếu ID' }, { status: 400 });
    }

    await prisma.store.delete({
      where: { Id: id },
    });

    return Response.json({ message: 'Xóa thành công' });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Delete failed' }, { status: 500 });
  }
}
