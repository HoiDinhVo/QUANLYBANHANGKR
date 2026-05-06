import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET — lấy danh sách hóa đơn trong thùng rác (DeletedAt != null)
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const storeId = searchParams.get('storeId') || '';

        // Sử dụng findMany thay vì $queryRaw để tránh lỗi tên bảng (Invoices vs Invoice)
        const invoices = await prisma.invoice.findMany({
            where: {
                DeletedAt: { not: null },
                ...(storeId && storeId !== 'all' ? { StoreId: storeId } : {})
            },
            include: {
                RoomSession: {
                    include: {
                        Room: true
                    }
                }
            },
            orderBy: {
                DeletedAt: 'desc'
            }
        });

        const transformed = invoices.map((inv) => ({
            id: inv.Id,
            customerName: inv.CustomerName || 'Khách lẻ',
            storeId: inv.StoreId,
            roomNumber: (inv.RoomSession?.Room as any)?.RoomNumber || (inv.RoomSession?.Room as any)?.roomNumber || '',
            totalPrice: Number(inv.TotalPrice || 0),
            createdAt: inv.CreatedAt,
            deletedAt: inv.DeletedAt,
        }));

        return NextResponse.json(transformed, {
            headers: {
                'Cache-Control': 's-maxage=30, stale-while-revalidate=300',
            },
        });
    } catch (error) {
        console.error('Trash fetch error:', error);
        return Response.json({ error: 'Server error' }, { status: 500 });
    }
}

// PATCH — khôi phục hóa đơn: set DeletedAt = NULL
export async function PATCH(request: NextRequest) {
    try {
        const { id, all, storeId } = await request.json();

        if (all) {
            await prisma.invoice.updateMany({
                where: {
                    DeletedAt: { not: null },
                    ...(storeId && storeId !== 'all' ? { StoreId: storeId } : {})
                },
                data: { DeletedAt: null }
            });
            return Response.json({ success: true });
        }

        if (!id) {
            return Response.json({ error: 'ID hóa đơn là bắt buộc' }, { status: 400 });
        }

        await prisma.invoice.update({
            where: { Id: id },
            data: { DeletedAt: null }
        });

        return Response.json({ success: true });
    } catch (error) {
        console.error('Restore error:', error);
        return Response.json({ error: 'Lỗi khi khôi phục hóa đơn' }, { status: 500 });
    }
}

// DELETE — xóa vĩnh viễn khỏi database (chỉ dùng từ trang thùng rác)
export async function DELETE(request: NextRequest) {
    try {
        const { id, all, storeId } = await request.json();

        if (all) {
            await prisma.invoice.deleteMany({
                where: {
                    DeletedAt: { not: null },
                    ...(storeId && storeId !== 'all' ? { StoreId: storeId } : {})
                }
            });
            return Response.json({ success: true });
        }

        if (!id) {
            return Response.json({ error: 'ID hóa đơn là bắt buộc' }, { status: 400 });
        }

        await prisma.invoice.delete({
            where: { Id: id },
        });

        return Response.json({ success: true });
    } catch (error) {
        console.error('Hard delete error:', error);
        return Response.json({ error: 'Lỗi khi xóa vĩnh viễn hóa đơn' }, { status: 500 });
    }
}