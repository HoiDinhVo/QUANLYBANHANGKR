'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import Swal from 'sweetalert2';
import { useAuth } from '@/app/context';
import { Store } from '@/lib/db';
import { ArrowLeft, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface TrashInvoice {
    id: string;
    customerName: string;
    storeId: string;
    roomNumber: string;
    totalPrice: number;
    createdAt: string | Date;
    deletedAt: string | Date;
}

export default function TrashPage() {
    const { user } = useAuth();
    const [invoices, setInvoices] = useState<TrashInvoice[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [selectedStoreId, setSelectedStoreId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (user !== undefined) {
            fetchInitialData();
        }
    }, [user]);

    const fetchInitialData = async () => {
        try {
            const storesRes = await fetch('/api/admin/stores');
            let storesData = (await storesRes.json()) || [];
            if (user?.storeId && user?.storeId !== 'all') {
                storesData = storesData.filter((s: Store) => s.id === user.storeId);
            }
            setStores(storesData);

            const initialStoreId = user?.storeId || (storesData.length > 0 ? storesData[0].id : '');
            setSelectedStoreId(initialStoreId);
            await fetchTrash(initialStoreId);
        } catch (error) {
            console.error('Lỗi tải dữ liệu:', error);
            await fetchTrash('');
        }
    };

    const fetchTrash = async (storeId: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (storeId && storeId !== 'all') params.append('storeId', storeId);

            const res = await fetch(`/api/invoices/trash?${params.toString()}`);
            const data = await res.json();
            const raw = Array.isArray(data) ? data : [];
            setInvoices(
                raw.map((inv: any) => ({
                    id: String(inv.id || ''),
                    customerName: inv.customerName || 'Khách lẻ',
                    storeId: inv.storeId || '',
                    roomNumber: inv.roomNumber || '',
                    totalPrice: Number(inv.totalPrice || 0),
                    createdAt: inv.createdAt,
                    deletedAt: inv.deletedAt,
                }))
            );
        } catch (error) {
            console.error('Lỗi tải thùng rác:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestore = async (id: string) => {
        try {
            const res = await fetch('/api/invoices/trash', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });

            if (res.ok) {
                setInvoices(prev => prev.filter(inv => inv.id !== id));
                toast.success('Đã khôi phục hóa đơn thành công');
            } else {
                toast.error('Lỗi khi khôi phục hóa đơn');
            }
        } catch (error) {
            console.error('Lỗi khôi phục:', error);
            toast.error('Lỗi khi khôi phục hóa đơn');
        }
    };

    const handleRestoreAll = async () => {
        if (invoices.length === 0) return;

        const result = await Swal.fire({
            title: 'Khôi phục tất cả?',
            text: `Bạn có chắc muốn khôi phục ${invoices.length} hóa đơn này quay lại danh sách chính?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#10b981',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Khôi phục tất cả',
            cancelButtonText: 'Hủy',
        });

        if (!result.isConfirmed) return;

        try {
            const res = await fetch('/api/invoices/trash', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    all: true,
                    storeId: selectedStoreId
                }),
            });

            if (!res.ok) throw new Error('Không thể khôi phục hóa đơn');

            setInvoices([]);
            toast.success('Đã khôi phục tất cả hóa đơn');
        } catch (error) {
            console.error('Lỗi khôi phục tất cả:', error);
            toast.error('Có lỗi xảy ra khi khôi phục hóa đơn');
        }
    };

    const handleHardDelete = async (id: string) => {
        const result = await Swal.fire({
            title: 'Xóa vĩnh viễn?',
            text: 'Hóa đơn sẽ bị xóa hoàn toàn khỏi hệ thống và không thể khôi phục.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Xóa vĩnh viễn',
            cancelButtonText: 'Hủy',
        });

        if (!result.isConfirmed) return;

        try {
            const res = await fetch('/api/invoices/trash', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });

            if (res.ok) {
                setInvoices(prev => prev.filter(inv => inv.id !== id));
                toast.success('Đã xóa vĩnh viễn hóa đơn');
            } else {
                toast.error('Lỗi khi xóa hóa đơn');
            }
        } catch (error) {
            console.error('Lỗi xóa vĩnh viễn:', error);
            toast.error('Lỗi khi xóa hóa đơn');
        }
    };

    const handleEmptyTrash = async () => {
        if (invoices.length === 0) return;

        const result = await Swal.fire({
            title: 'Dọn sạch thùng rác?',
            text: `Tất cả ${invoices.length} hóa đơn sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Dọn sạch',
            cancelButtonText: 'Hủy',
        });

        if (!result.isConfirmed) return;

        try {
            const res = await fetch('/api/invoices/trash', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    all: true,
                    storeId: selectedStoreId
                }),
            });

            if (!res.ok) throw new Error('Không thể dọn sạch thùng rác');

            setInvoices([]);
            toast.success('Đã dọn sạch thùng rác');
        } catch (error) {
            console.error('Lỗi dọn thùng rác:', error);
            toast.error('Có lỗi xảy ra khi dọn thùng rác');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard/invoice">
                            <Button variant="ghost" size="sm" className="text-slate-600">
                                <ArrowLeft className="w-4 h-4 mr-2" /> Quay lại
                            </Button>
                        </Link>
                        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-rose-500" /> Thùng rác hóa đơn
                        </h1>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Lọc chi nhánh (chỉ admin) */}
                        {user?.role === 'admin' && (!user?.storeId || user.storeId === 'all') && stores.length > 0 && (
                            <select
                                value={selectedStoreId}
                                onChange={(e) => {
                                    setSelectedStoreId(e.target.value);
                                    fetchTrash(e.target.value);
                                }}
                                className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Tất cả chi nhánh</option>
                                {stores.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Banner thông tin */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
                    <div className="text-amber-500 mt-0.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-amber-800">Hóa đơn trong thùng rác</p>
                        <p className="text-xs text-amber-600 mt-0.5">
                            Các hóa đơn này đã bị xóa tạm. Bạn có thể khôi phục hoặc xóa vĩnh viễn.
                            Hóa đơn trong thùng rác sẽ không hiển thị trong thống kê.
                        </p>
                    </div>
                </div>

                {/* Bảng thùng rác */}
                <Card className="bg-white border-none shadow-sm overflow-hidden rounded-2xl">
                    {isLoading ? (
                        <div className="p-12 text-center text-slate-400">Đang tải dữ liệu...</div>
                    ) : invoices.length === 0 ? (
                        <div className="p-16 text-center">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                <Trash2 className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="text-slate-400 font-medium">Thùng rác trống</p>
                            <p className="text-slate-300 text-sm mt-1">Không có hóa đơn nào trong thùng rác</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <div className="flex items-center justify-end p-4 gap-2">
                                {invoices.length > 0 && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleRestoreAll}
                                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border border-emerald-100 gap-2"
                                        >
                                            <RotateCcw className="w-4 h-4" /> Khôi phục tất cả
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleEmptyTrash}
                                            className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-rose-100 gap-2"
                                        >
                                            <Trash2 className="w-4 h-4" /> Dọn sạch
                                        </Button>
                                    </>
                                )}
                            </div>
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Mã HD</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Phòng</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Khách hàng</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Tổng tiền</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Ngày tạo</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Ngày xóa</th>
                                        <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {invoices.map((inv) => (
                                        <tr key={inv.id} className="hover:bg-rose-50/20 transition-colors">
                                            <td className="px-6 py-4 text-sm font-medium text-slate-400 line-through">
                                                #{inv.id.substring(0, 8).toUpperCase()}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-400">
                                                Phòng {inv.roomNumber}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-400">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${inv.customerName === 'Khách lẻ'
                                                    ? 'bg-slate-100 text-slate-400'
                                                    : 'bg-blue-50 text-blue-400'
                                                    }`}>
                                                    {inv.customerName}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-400">
                                                {(Math.ceil(inv.totalPrice / 1000) * 1000).toLocaleString('vi-VN')}đ
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-400">
                                                {new Date(inv.createdAt).toLocaleString('vi-VN')}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-rose-400 font-medium">
                                                {new Date(inv.deletedAt).toLocaleString('vi-VN')}
                                            </td>
                                            <td className="px-6 py-4 text-right space-x-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1"
                                                    onClick={() => handleRestore(inv.id)}
                                                >
                                                    <RotateCcw className="w-4 h-4" /> Khôi phục
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 gap-1"
                                                    onClick={() => handleHardDelete(inv.id)}
                                                >
                                                    <Trash2 className="w-4 h-4" /> Xóa vĩnh viễn
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}