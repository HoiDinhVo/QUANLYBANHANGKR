'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useAuth } from '@/app/context';
import { Store } from '@/lib/db';
import { ArrowLeft, Users, BarChart3, TrendingUp } from 'lucide-react';

// Chart.js được load qua CDN script tag bên dưới, dùng window.Chart
declare const Chart: any;

interface DisplayInvoice {
    id: string;
    totalPrice: number;
    createdAt: string | Date;
    customerName?: string;
}

interface CustomerStat {
    name: string;
    count: number;
    total: number;
}

export default function CustomersPage() {
    const { user } = useAuth();
    const [invoices, setInvoices] = useState<DisplayInvoice[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [selectedStoreId, setSelectedStoreId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reportType, setReportType] = useState<'custom' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
    const [isMounted, setIsMounted] = useState(false);
    const [chartReady, setChartReady] = useState(false);

    // Refs cho 2 canvas
    const spendingChartRef = useRef<HTMLCanvasElement>(null);
    const visitsChartRef = useRef<HTMLCanvasElement>(null);
    const spendingChartInstance = useRef<any>(null);
    const visitsChartInstance = useRef<any>(null);

    // Load Chart.js từ CDN một lần duy nhất
    useEffect(() => {
        if (typeof window !== 'undefined' && !(window as any).Chart) {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
            script.onload = () => setChartReady(true);
            document.head.appendChild(script);
        } else {
            setChartReady(true);
        }
    }, []);

    useEffect(() => { setIsMounted(true); }, []);
    useEffect(() => { if (user !== undefined) fetchInitialData(); }, [user]);

    const fetchInitialData = async () => {
        try {
            const storesRes = await fetch('/api/admin/stores');
            let storesData = (await storesRes.json()) || [];
            if (user?.role !== 'admin' && user?.storeId) {
                storesData = storesData.filter((s: Store) => s.id === user.storeId);
            }
            setStores(storesData);
            const initialStoreId = user?.storeId || (storesData.length > 0 ? storesData[0].id : '');
            setSelectedStoreId(initialStoreId);
            await fetchInvoices(initialStoreId);
        } catch (error) {
            console.error(error);
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
            setInvoices(rawInvoices.map((inv: any) => ({
                id: String(inv.id || inv.Id || ''),
                totalPrice: Number(inv.totalPrice || inv.TotalPrice || 0),
                createdAt: inv.createdAt || inv.CreatedAt,
                customerName: inv.customerName || inv.CustomerName || 'Khách lẻ',
            })));
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    // Tự động cập nhật ngày khi chọn bộ lọc nhanh
    useEffect(() => {
        const now = new Date();
        const formatDate = (date: Date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };
        if (reportType === 'daily') {
            setStartDate(formatDate(now));
            setEndDate(formatDate(now));
        } else if (reportType === 'weekly') {
            const first = now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1);
            const firstDay = new Date(new Date(now).setDate(first));
            setStartDate(formatDate(firstDay));
            setEndDate(formatDate(new Date()));
        } else if (reportType === 'monthly') {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(formatDate(firstDay));
            setEndDate(formatDate(new Date()));
        } else if (reportType === 'yearly') {
            setStartDate(`${now.getFullYear()}-01-01`);
            setEndDate(formatDate(new Date()));
        }
    }, [reportType]);

    const filteredInvoices = useMemo(() => invoices.filter(inv => {
        // Không thống kê các hóa đơn xuất kho (Tặng/Mang về)
        if (inv.id.startsWith('GFT') || inv.id.startsWith('TKW')) {
            return false;
        }

        const matchSearch = (inv.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchSearch) return false;
        if (startDate || endDate) {
            const invDate = new Date(inv.createdAt);
            if (startDate && invDate < new Date(startDate)) return false;
            if (endDate && invDate > new Date(new Date(endDate).setHours(23, 59, 59))) return false;
        }
        return true;
    }), [invoices, searchTerm, startDate, endDate]);

    const customerStats = useMemo((): CustomerStat[] => {
        const groups: { [key: string]: { count: number; total: number } } = {};
        filteredInvoices.forEach(inv => {
            const name = inv.customerName?.trim() || 'Khách lẻ';
            if (!groups[name]) groups[name] = { count: 0, total: 0 };
            groups[name].count += 1;
            groups[name].total += inv.totalPrice;
        });
        return Object.entries(groups)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.total - a.total);
    }, [filteredInvoices]);

    const totalSpendingAll = filteredInvoices.reduce((sum, inv) => sum + inv.totalPrice, 0);
    const avgPerCustomer = customerStats.length > 0
        ? Math.round(customerStats.reduce((s, c) => s + c.total, 0) / customerStats.length)
        : 0;

    // ─── VẼ BIỂU ĐỒ GROUPED BAR: số lần ghé + chi tiêu ───
    const drawDualChart = useCallback(() => {
        if (!chartReady || !spendingChartRef.current) return;
        const top10 = customerStats.slice(0, 10);
        if (top10.length === 0) return;

        const labels = top10.map(c => {
            const parts = c.name.trim().split(' ');
            return parts.slice(-2).join(' ');
        });
        const countData = top10.map(c => c.count);
        const totalData = top10.map(c => parseFloat((c.total / 1_000_000).toFixed(2)));

        if (spendingChartInstance.current) spendingChartInstance.current.destroy();

        spendingChartInstance.current = new (window as any).Chart(spendingChartRef.current, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Số lần ghé',
                        data: countData,
                        backgroundColor: 'rgba(79,70,229,0.78)',
                        borderRadius: 5,
                        borderSkipped: false,
                        yAxisID: 'yCount',
                    },
                    {
                        label: 'Chi tiêu (triệu đ)',
                        data: totalData,
                        backgroundColor: 'rgba(16,185,129,0.72)',
                        borderRadius: 5,
                        borderSkipped: false,
                        yAxisID: 'yTotal',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#fff',
                        titleColor: '#1e293b',
                        bodyColor: '#475569',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 10,
                        callbacks: {
                            title: (items: any[]) => top10[items[0].dataIndex]?.name || '',
                            label: (item: any) => {
                                if (item.datasetIndex === 0)
                                    return `  Số lần ghé: ${item.raw} lần`;
                                const raw = top10[item.dataIndex];
                                const m = (raw?.total / 1_000_000).toFixed(2);
                                return `  Chi tiêu: ${m}M (${raw?.total.toLocaleString('vi-VN')}đ)`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            font: { size: 11 },
                            color: '#64748b',
                            maxRotation: 30,
                            autoSkip: false,
                        },
                    },
                    yCount: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: 'Số lần ghé', color: '#4f46e5', font: { size: 11 } },
                        grid: { color: '#f1f5f9' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, color: '#4f46e5', stepSize: 1 },
                    },
                    yTotal: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Chi tiêu (triệu đ)', color: '#10b981', font: { size: 11 } },
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                            font: { size: 11 },
                            color: '#10b981',
                            callback: (v: number) => `${Number(v).toFixed(1)}M`,
                        },
                    },
                },
            },
        });
    }, [chartReady, customerStats]);

    // ─── VẼ BIỂU ĐỒ NGANG: top lượt ghé ───
    const drawVisitsChart = useCallback(() => {
        if (!chartReady || !visitsChartRef.current) return;
        const top10 = [...customerStats].sort((a, b) => b.count - a.count).slice(0, 10);
        if (top10.length === 0) return;

        const labels = top10.map(c => c.name.trim().split(' ').slice(-2).join(' '));

        if (visitsChartInstance.current) visitsChartInstance.current.destroy();

        visitsChartInstance.current = new (window as any).Chart(visitsChartRef.current, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Số lần ghé',
                        data: top10.map(c => c.count),
                        backgroundColor: top10.map((_, i) => {
                            const palette = [
                                'rgba(79,70,229,0.8)',
                                'rgba(16,185,129,0.8)',
                                'rgba(245,158,11,0.8)',
                                'rgba(239,68,68,0.8)',
                                'rgba(139,92,246,0.8)',
                                'rgba(236,72,153,0.8)',
                                'rgba(6,182,212,0.8)',
                                'rgba(234,179,8,0.8)',
                                'rgba(20,184,166,0.8)',
                                'rgba(249,115,22,0.8)',
                            ];
                            return palette[i % palette.length];
                        }),
                        borderRadius: [0, 4, 4, 0] as any,
                        borderSkipped: false,
                        barThickness: 22,
                    },
                ],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#fff',
                        titleColor: '#1e293b',
                        bodyColor: '#475569',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        cornerRadius: 10,
                        callbacks: {
                            title: (items: any[]) => top10[items[0].dataIndex]?.name || '',
                            label: (item: any) => `  Số lần ghé: ${item.raw} lần`,
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: '#f1f5f9' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, color: '#64748b', stepSize: 1 },
                    },
                    y: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { font: { size: 11, weight: '500' as any }, color: '#334155' },
                    },
                },
            },
        });
    }, [chartReady, customerStats]);

    useEffect(() => { drawDualChart(); }, [drawDualChart]);
    useEffect(() => { drawVisitsChart(); }, [drawVisitsChart]);

    // Cleanup khi unmount
    useEffect(() => {
        return () => {
            spendingChartInstance.current?.destroy();
            visitsChartInstance.current?.destroy();
        };
    }, []);

    if (!isMounted || isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm text-slate-400">Đang tải phân tích...</p>
                </div>
            </div>
        );
    }

    const QUICK_FILTERS = [
        { id: 'daily', label: 'Ngày' },
        { id: 'weekly', label: 'Tuần' },
        { id: 'monthly', label: 'Tháng' },
        { id: 'yearly', label: 'Năm' },
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard">
                            <Button variant="ghost" size="sm">
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Quay lại
                            </Button>
                        </Link>
                        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <Users className="w-5 h-5 text-indigo-600" />
                            Khách Hàng
                        </h1>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Bộ lọc */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-8 items-end">
                    {user?.role === 'admin' && (
                        <div className="md:col-span-3">
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Chi nhánh</label>
                            <select
                                value={selectedStoreId}
                                onChange={(e) => { setSelectedStoreId(e.target.value); fetchInvoices(e.target.value); }}
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"
                            >
                                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                    )}

                    <div className="md:col-span-3 flex bg-white p-1 rounded-xl border border-slate-200 h-10">
                        {QUICK_FILTERS.map(type => (
                            <button
                                key={type.id}
                                onClick={() => setReportType(type.id as any)}
                                className={`flex-1 rounded-lg text-xs font-bold transition-all ${reportType === type.id ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                {type.label}
                            </button>
                        ))}
                    </div>

                    <div className="md:col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Từ ngày</label>
                        <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setReportType('custom'); }} />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Đến ngày</label>
                        <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setReportType('custom'); }} />
                    </div>
                    <div className="md:col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Tìm khách</label>
                        <Input placeholder="Tên khách hàng..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                </div>

                {/* Stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                    <div className="bg-indigo-50 rounded-2xl p-4">
                        <p className="text-xs font-bold text-indigo-500 uppercase mb-1">Doanh thu</p>
                        <p className="text-xl font-black text-indigo-700">{totalSpendingAll.toLocaleString('vi-VN')}đ</p>
                    </div>
                    <div className="bg-emerald-50 rounded-2xl p-4">
                        <p className="text-xs font-bold text-emerald-600 uppercase mb-1">Tổng lượt</p>
                        <p className="text-xl font-black text-emerald-700">{filteredInvoices.length}</p>
                    </div>
                    <div className="bg-violet-50 rounded-2xl p-4">
                        <p className="text-xs font-bold text-violet-600 uppercase mb-1">Nhóm khách</p>
                        <p className="text-xl font-black text-violet-700">{customerStats.length}</p>
                    </div>
                    <div className="bg-amber-50 rounded-2xl p-4">
                        <p className="text-xs font-bold text-amber-600 uppercase mb-1">TB / khách</p>
                        <p className="text-xl font-black text-amber-700">{avgPerCustomer.toLocaleString('vi-VN')}đ</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* ── Biểu đồ dual-axis: số lần + tổng tiền ── */}
                    <Card className="lg:col-span-2 p-6 border-none shadow-sm rounded-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-indigo-600" />
                                Số lần ghé &amp; Chi tiêu (top 10)
                            </h2>
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" />
                                    Số lần ghé
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
                                    Chi tiêu
                                </span>
                            </div>
                        </div>
                        {customerStats.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-300">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                                <p className="text-sm text-slate-400 font-medium">Không có dữ liệu trong khoảng thời gian này</p>
                                <p className="text-xs text-slate-300">Thử chọn khoảng ngày khác</p>
                            </div>
                        ) : (
                            <div style={{ position: 'relative', width: '100%', height: 360 }}>
                                <canvas
                                    ref={spendingChartRef}
                                    role="img"
                                    aria-label="Biểu đồ cột số lần ghé và đường tổng chi tiêu của top 10 khách hàng"
                                />
                            </div>
                        )}
                    </Card>

                    {/* ── Panel tổng hợp + top lượt ghé ngang ── */}
                    <Card className="p-6 border-none shadow-sm rounded-2xl">
                        <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-indigo-600" />
                            Top lượt ghé
                        </h2>
                        {customerStats.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-300">
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                <p className="text-xs text-slate-400">Chưa có dữ liệu</p>
                            </div>
                        ) : (
                            <div style={{ position: 'relative', width: '100%', height: Math.max(customerStats.slice(0, 10).length * 40 + 40, 200) }}>
                                <canvas
                                    ref={visitsChartRef}
                                    role="img"
                                    aria-label="Biểu đồ ngang số lần ghé của top 10 khách hàng"
                                />
                            </div>
                        )}
                    </Card>

                    {/* ── Xếp hạng chi tiết ── */}
                    <Card className="lg:col-span-2 p-6 border-none shadow-sm rounded-2xl">
                        <h2 className="text-base font-bold text-slate-800 mb-4">Xếp hạng chi tiết</h2>
                        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                            {customerStats.map((c, i) => {
                                const percent = totalSpendingAll > 0 ? Math.round((c.total / totalSpendingAll) * 100) : 0;
                                const initials = c.name.trim().split(' ').slice(-2).map((w: string) => w[0]).join('').toUpperCase();
                                return (
                                    <div key={c.name} className="group p-3 hover:bg-slate-50 rounded-xl transition-all">
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-black text-slate-300 w-4">{i + 1}.</span>
                                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">
                                                    {initials}
                                                </div>
                                                <span className="text-sm font-bold text-slate-700">{c.name}</span>
                                            </div>
                                            <div className="text-right flex-shrink-0 ml-2">
                                                <div className="text-sm font-black text-indigo-600">{c.total.toLocaleString('vi-VN')}đ</div>
                                                <div className="text-[10px] font-bold text-emerald-500 uppercase">{c.count} lượt ghé</div>
                                            </div>
                                        </div>
                                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden ml-11">
                                            <div
                                                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                                                style={{ width: `${percent}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                            {customerStats.length === 0 && (
                                <p className="text-center text-sm text-slate-400 py-8">Không có khách hàng định danh trong khoảng thời gian này</p>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}