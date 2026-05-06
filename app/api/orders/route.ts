import { prisma } from '@/lib/prisma';

async function getProductWithStock(productId: string) {
  try {
    const product = await prisma.product.findUnique({
      where: { Id: productId },
    });
    if (!product) return null;
    return {
      id: product.Id,
      name: product.Name,
      price: Number(product.Price),
      quantity: product.Quantity,
      source: 'sql' as const,
    };
  } catch (error) {
    console.log('Product not found in SQL Server, trying mock data');
  }

  // Fallback to mock data if needed
  return null;
}

export async function POST(request: Request) {
  try {
    const { roomSessionId, productId, quantity } = await request.json();
    const parsedQuantity = Number(quantity);

    if (!roomSessionId || !productId || isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return Response.json({ error: 'Invalid order payload' }, { status: 400 });
    }

    const product = await getProductWithStock(productId);
    if (!product) {
      return Response.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.quantity < parsedQuantity) {
      return Response.json({ error: 'Số lượng trong kho không đủ' }, { status: 400 });
    }

    const orderItem = await prisma.orderItem.create({
      data: {
        Id: Date.now().toString(),
        RoomSessionId: roomSessionId,
        ProductId: productId,
        ProductName: product.name,
        Price: product.price,
        Quantity: parsedQuantity,
        OrderedAt: new Date(),
      },
    });

    return Response.json({
      id: orderItem.Id,
      roomSessionId: orderItem.RoomSessionId,
      productId: orderItem.ProductId,
      productName: orderItem.ProductName,
      price: Number(orderItem.Price),
      quantity: orderItem.Quantity,
      orderedAt: orderItem.OrderedAt,
    });
  } catch (error) {
    console.error('Error in POST /api/orders:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id, quantity, price, productName } = await request.json();
    const parsedQuantity = quantity !== undefined ? Number(quantity) : undefined;
    const parsedPrice = price !== undefined ? Number(price) : undefined;

    if (!id) {
      return Response.json({ error: 'Order item ID is required' }, { status: 400 });
    }

    if (parsedQuantity !== undefined && (isNaN(parsedQuantity) || parsedQuantity < 0)) {
      return Response.json({ error: 'Invalid quantity' }, { status: 400 });
    }

    if (parsedPrice !== undefined && (isNaN(parsedPrice) || parsedPrice < 0)) {
      return Response.json({ error: 'Invalid price' }, { status: 400 });
    }

    const existingItem = await prisma.orderItem.findUnique({
      where: { Id: id },
      include: { RoomSession: { select: { Status: true } } },
    });

    if (!existingItem) {
      return Response.json({ error: 'Order item not found' }, { status: 404 });
    }

    // Chặn sửa item của session đã thanh toán: stock đã decrement, sửa Quantity
    // ở đây sẽ làm sales record lệch với stock thực tế trong kho.
    if (existingItem.RoomSession?.Status === 'completed') {
      return Response.json(
        { error: 'Không thể sửa món của phiên đã thanh toán' },
        { status: 400 }
      );
    }

    if (parsedQuantity !== undefined) {
      const delta = parsedQuantity - existingItem.Quantity;
      if (delta > 0) {
        const product = await getProductWithStock(existingItem.ProductId);
        if (!product) {
          return Response.json({ error: 'Product not found' }, { status: 404 });
        }
        if (product.quantity < delta) {
          return Response.json({ error: 'Số lượng trong kho không đủ' }, { status: 400 });
        }
      }
    }

    const updatedItem = await prisma.orderItem.update({
      where: { Id: id },
      data: {
        ...(parsedQuantity !== undefined ? { Quantity: parsedQuantity } : {}),
        ...(parsedPrice !== undefined ? { Price: parsedPrice } : {}),
        ...(productName !== undefined ? { ProductName: productName } : {}),
      },
    });

    return Response.json({
      id: updatedItem.Id,
      roomSessionId: updatedItem.RoomSessionId,
      productId: updatedItem.ProductId,
      productName: updatedItem.ProductName,
      price: Number(updatedItem.Price),
      quantity: updatedItem.Quantity,
      orderedAt: updatedItem.OrderedAt,
    });
  } catch (error) {
    console.error('Error in PUT /api/orders:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return Response.json({ error: 'Order item ID is required' }, { status: 400 });
    }

    const orderItem = await prisma.orderItem.findUnique({
      where: { Id: id },
      include: { RoomSession: { select: { Status: true } } },
    });

    if (!orderItem) {
      return Response.json({ error: 'Order item not found' }, { status: 404 });
    }

    // Chặn xóa item của session đã thanh toán: stock đã decrement, xóa
    // OrderItem ở đây sẽ làm sales record biến mất nhưng kho không hoàn lại.
    if (orderItem.RoomSession?.Status === 'completed') {
      return Response.json(
        { error: 'Không thể xóa món của phiên đã thanh toán' },
        { status: 400 }
      );
    }

    await prisma.orderItem.delete({
      where: { Id: id },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/orders:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    // Cache ngắn 5s. Orders đổi mỗi khi nhân viên gọi món, nhưng dashboard
    // chỉ cần "tổng tương đối" để hiển thị; trang phòng có nút Refresh thủ công.
    const headers = {
      'Cache-Control': 's-maxage=5, stale-while-revalidate=30',
    };

    // If sessionId is provided, return orders for that session
    if (sessionId) {
      const items = await prisma.orderItem.findMany({
        where: { RoomSessionId: sessionId },
      });

      return Response.json(
        items.map(item => ({
          id: item.Id,
          roomSessionId: item.RoomSessionId,
          productId: item.ProductId,
          productName: item.ProductName,
          price: Number(item.Price),
          quantity: item.Quantity,
          orderedAt: item.OrderedAt,
        })),
        { headers },
      );
    }

    // Otherwise, return all orders
    const allItems = await prisma.orderItem.findMany();
    return Response.json(
      allItems.map(item => ({
        id: item.Id,
        roomSessionId: item.RoomSessionId,
        productId: item.ProductId,
        productName: item.ProductName,
        price: Number(item.Price),
        quantity: item.Quantity,
        orderedAt: item.OrderedAt,
      })),
      { headers },
    );
  } catch (error) {
    console.error('Error in GET /api/orders:', error);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
