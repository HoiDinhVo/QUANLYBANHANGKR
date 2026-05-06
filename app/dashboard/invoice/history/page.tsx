'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import Swal from 'sweetalert2';
import { useAuth } from '@/app/context';
import { Store } from '@/lib/db';
import { History, Search, Eye, ArrowLeft, Calendar, X, BarChart3, Users, Download, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

interface DisplayInvoice {
    id: string;
    totalPrice: number;
    createdAt: string | Date;
    roomNumber: string;
    status?: string;
    customerName?: string;
}

export default function InvoiceHistoryPage() {
    const { user } = useAuth();
    const [invoices, setInvoices] = useState<DisplayInvoice[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [selectedStoreId, setSelectedStoreId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

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
            await fetchInvoices(initialStoreId);
        } catch (error) {
            console.error('Lỗi tải dữ liệu:', error);
            await fetchInvoices('');
        }
    };

    const fetchInvoices = async (storeId: string) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (storeId && storeId !== 'all') params.append('storeId', storeId);

            const res = await fetch(`/api/invoices?${params.toString()}`);
            const data = await res.json();

            const rawInvoices = Array.isArray(data) ? data : (data?.invoices || data?.data || []);
            const normalized: DisplayInvoice[] = rawInvoices.map((inv: any) => ({
                ...inv,
                id: String(inv.id || inv.Id || ''),
                totalPrice: Number(inv.totalPrice || inv.TotalPrice || 0),
                createdAt: inv.createdAt || inv.CreatedAt,
                roomNumber: inv.roomNumber || inv.RoomSession?.Room?.RoomNumber || inv.RoomSession?.Room?.roomNumber || '',
                customerName: inv.customerName || inv.CustomerName || 'Khách lẻ',
            }));
            setInvoices(normalized);
        } catch (error) {
            console.error('Lỗi tải hóa đơn:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredInvoices = useMemo(() => invoices.filter(inv => {
        const matchSearch = inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (inv.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchSearch) return false;

        if (startDate || endDate) {
            const invDate = new Date(inv.createdAt);
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                if (invDate < start) return false;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                if (invDate > end) return false;
            }
        }
        return true;
    }), [invoices, searchTerm, startDate, endDate]);

    const chartData = useMemo(() => {
        const groups: { [key: string]: { count: number; dateObj: Date } } = {};
        filteredInvoices.forEach(inv => {
            if (!inv.createdAt) return;
            const date = new Date(inv.createdAt);
            if (isNaN(date.getTime())) return;
            const key = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            if (!groups[key]) {
                groups[key] = { count: 0, dateObj: new Date(date.getFullYear(), date.getMonth(), date.getDate()) };
            }
            groups[key].count += 1;
        });
        return Object.entries(groups)
            .map(([name, data]) => ({ name, count: data.count, dateObj: data.dateObj }))
            .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    }, [filteredInvoices]);

    const customerStats = useMemo(() => {
        const groups: { [key: string]: number } = {};
        filteredInvoices.forEach(inv => {
            // Loại bỏ hóa đơn Tặng/Mang về khỏi biểu đồ và danh sách thống kê khách hàng
            if (inv.id.startsWith('GFT') || inv.id.startsWith('TKW')) return;

            const name = inv.customerName?.trim() || 'Khách lẻ';
            groups[name] = (groups[name] || 0) + 1;
        });
        return Object.entries(groups)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
    }, [filteredInvoices]);

    const totalLe = customerStats.find(c => c.name === 'Khách lẻ')?.count || 0;
    const totalNamed = customerStats
        .filter(c => c.name !== 'Khách lẻ')
        .reduce((sum, c) => sum + c.count, 0);
    const namedCustomers = customerStats.filter(c => c.name !== 'Khách lẻ');

    const handleDeleteInvoice = async (id: string) => {
        const result = await Swal.fire({
            title: 'Chuyển vào thùng rác?',
            text: 'Hóa đơn sẽ được chuyển vào thùng rác. Bạn có thể khôi phục lại sau.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Chuyển vào thùng rác',
            cancelButtonText: 'Hủy',
        });

        if (!result.isConfirmed) return;

        try {
            const response = await fetch('/api/invoices', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });

            if (response.ok) {
                setInvoices(invoices.filter((inv) => inv.id !== id));
                toast.success('Đã chuyển hóa đơn vào thùng rác');
            } else {
                toast.error('Lỗi khi xóa hóa đơn');
            }
        } catch (error) {
            console.error('Lỗi khi xóa hóa đơn:', error);
            toast.error('Lỗi khi xóa hóa đơn');
        }
    };

    const handleExportExcel = () => {
        if (filteredInvoices.length === 0) {
            toast.error('Không có dữ liệu để xuất');
            return;
        }

        const headers = ['Mã HD', 'Phòng', 'Khách hàng', 'Thời gian', 'Tổng tiền (VNĐ)'];
        const csvData = filteredInvoices.map(inv => [
            `#${inv.id.substring(0, 8).toUpperCase()}`,
            `Phòng ${inv.roomNumber}`,
            inv.customerName || 'Khách lẻ',
            new Date(inv.createdAt).toLocaleString('vi-VN'),
            Math.ceil(inv.totalPrice / 1000) * 1000,
        ]);

        const csvContent = [headers.join(','), ...csvData.map(e => e.join(','))].join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `lich-su-hoa-don-${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard">
                            <Button variant="ghost" size="sm" className="text-slate-600">
                                <ArrowLeft className="w-4 h-4 mr-2" /> Quay lại
                            </Button>
                        </Link>
                        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <History className="w-5 h-5 text-blue-600" /> Lịch sử hóa đơn
                        </h1>
                    </div>
                    {/* Nút thùng rác */}
                    <Link href="/dashboard/invoice/trash">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 border border-rose-100 gap-2"
                        >
                            <Trash2 className="w-4 h-4" /> Thùng rác
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Bộ lọc */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8 items-end">
                    <div className={`w-full ${(user?.role !== 'admin' || (user?.storeId && user.storeId !== 'all')) ? 'hidden' : ''}`}>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Chi nhánh</label>
                        <select
                            value={selectedStoreId}
                            onChange={(e) => {
                                setSelectedStoreId(e.target.value);
                                fetchInvoices(e.target.value);
                            }}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Tất cả chi nhánh</option>
                            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>

                    <div className="w-full">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Từ ngày</label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="pl-10 bg-white border-slate-200 shadow-sm h-10"
                            />
                        </div>
                    </div>

                    <div className="w-full">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Đến ngày</label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="pl-10 bg-white border-slate-200 shadow-sm h-10"
                            />
                        </div>
                    </div>

                    <div className="w-full">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Tìm kiếm</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Mã HD hoặc tên khách..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 bg-white border-slate-200 shadow-sm h-10"
                            />
                        </div>
                    </div>

                    <div className="w-full flex items-end gap-2">
                        <Button
                            onClick={handleExportExcel}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-10 flex-1 gap-2 rounded-lg shadow-sm"
                        >
                            <Download className="w-4 h-4" /> Xuất Excel
                        </Button>
                        {(startDate || endDate || searchTerm) && (
                            <Button
                                variant="ghost"
                                onClick={() => { setStartDate(''); setEndDate(''); setSearchTerm(''); }}
                                className="text-slate-400 hover:text-rose-500 h-10 px-3 border border-slate-200 rounded-lg hover:bg-rose-50"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Biểu đồ lượt khách theo ngày */}
                {isMounted && chartData.length > 0 && (
                    <Card className="p-6 border-none shadow-sm bg-white rounded-2xl mb-6">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-blue-600" /> Thống kê lượt khách theo ngày
                        </h2>
                        <div style={{ width: '100%', height: 250 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                                    <Tooltip
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Số lượt khách" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                )}

                {/* Thống kê khách hàng */}
                {isMounted && filteredInvoices.length > 0 && (
                    <Card className="p-6 border-none shadow-sm bg-white rounded-2xl mb-6">
                        <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" /> Thống kê khách hàng
                        </h2>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="bg-blue-50 rounded-xl p-4 text-center">
                                <p className="text-xs font-bold text-blue-400 uppercase mb-1">Khách hàng</p>
                                <p className="text-3xl font-black text-blue-600">{totalNamed}</p>
                                <p className="text-xs text-blue-400 mt-1">lượt</p>
                            </div>
                            <div className="bg-slate-50 rounded-xl p-4 text-center">
                                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Khách lẻ</p>
                                <p className="text-3xl font-black text-slate-600">{totalLe}</p>
                                <p className="text-xs text-slate-400 mt-1">lượt</p>
                            </div>
                        </div>

                        {namedCustomers.length > 0 && (
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase mb-4">Chi tiết khách hàng</p>
                                <div className="space-y-3">
                                    {namedCustomers.map(({ name, count }) => {
                                        const percent = Math.round((count / filteredInvoices.length) * 100);
                                        return (
                                            <div key={name} className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold flex-shrink-0">
                                                    {name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="text-sm font-semibold text-slate-700 truncate">{name}</span>
                                                        <span className="text-xs font-bold text-blue-600 ml-2 flex-shrink-0">{count} lượt</span>
                                                    </div>
                                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                            style={{ width: `${percent}%` }}
                                                        />
                                                    </div>
                                                </div>
                                                <span className="text-xs text-slate-400 w-9 text-right flex-shrink-0">{percent}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {namedCustomers.length === 0 && (
                            <p className="text-center text-slate-400 text-sm italic py-4">
                                Tất cả đều là khách lẻ trong khoảng thời gian này
                            </p>
                        )}
                    </Card>
                )}

                {/* Bảng danh sách hóa đơn */}
                <Card className="bg-white border-none shadow-sm overflow-hidden rounded-2xl">
                    {isLoading ? (
                        <div className="p-12 text-center text-slate-400">Đang tải dữ liệu...</div>
                    ) : filteredInvoices.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 italic">Không tìm thấy hóa đơn nào</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Mã HD</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Phòng</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Thời gian</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Tổng tiền</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase">Khách hàng</th>
                                        <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredInvoices.map((inv) => (
                                        <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4 text-sm font-medium text-slate-900">
                                                #{inv.id.substring(0, 8).toUpperCase()}
                                            </td>
                                            <td className="px-6 py-4 text-sm font-bold text-slate-700">
                                                Phòng {inv.roomNumber}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600">
                                                {new Date(inv.createdAt).toLocaleString('vi-VN')}
                                            </td>
                                            <td className="px-6 py-4 text-sm font-bold text-blue-600">
                                                {(Math.ceil(inv.totalPrice / 1000) * 1000).toLocaleString('vi-VN')}đ
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${inv.customerName === 'Khách lẻ'
                                                    ? 'bg-slate-100 text-slate-600'
                                                    : 'bg-blue-100 text-blue-700'
                                                    }`}>
                                                    {inv.customerName}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right space-x-2">
                                                <Link href={`/dashboard/invoice/${inv.id}`}>
                                                    <Button variant="ghost" size="sm" className="text-slate-600 hover:text-blue-600 gap-1">
                                                        <Eye className="w-4 h-4" /> Xem
                                                    </Button>
                                                </Link>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-slate-600 hover:text-rose-600 gap-1"
                                                    onClick={() => handleDeleteInvoice(inv.id)}
                                                >
                                                    <Trash2 className="w-4 h-4" /> Xóa
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