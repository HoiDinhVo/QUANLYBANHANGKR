'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Invoice, Room, Store } from '@/lib/db';

export default function InvoicePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const invoiceId = params.id as string;
  const shouldAutoPrint = searchParams.get('print') === 'true';

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchInvoiceData();
  }, [invoiceId]);

  useEffect(() => {
    if (shouldAutoPrint && invoice && !isLoading && invoice.items) {
      // Sau khi đóng hộp thoại in (in xong hoặc user hủy) → quay về trang chủ
      const onAfterPrint = () => {
        router.push('/dashboard');
      };
      window.addEventListener('afterprint', onAfterPrint);
      const animationId = requestAnimationFrame(() => {
        window.print();
      });
      return () => {
        window.removeEventListener('afterprint', onAfterPrint);
        cancelAnimationFrame(animationId);
      };
    }
  }, [shouldAutoPrint, invoice, isLoading, router]);

  const fetchInvoiceData = async () => {
    try {
      const invoiceResponse = await fetch(`/api/invoices/${invoiceId}`);
      if (!invoiceResponse.ok) throw new Error('Invoice not found');
      const data = await invoiceResponse.json();

      const normalizedInvoice = {
        ...data,
        id: data.id || data.Id,
        storeId: data.storeId || data.StoreId,
        roomId: data.roomId || data.RoomId,
        roomSessionId: data.roomSessionId || data.RoomSessionId,
        totalPrice: Number(data.totalPrice || data.TotalPrice || 0),
        roomCost: Number(data.roomCost || data.RoomCost || 0),
        startTime: data.startTime || data.StartTime,
        endTime: data.endTime || data.EndTime,
        createdAt: data.createdAt || data.CreatedAt,
        customerName: data.customerName || data.CustomerName || '',
      };
      setInvoice(normalizedInvoice);

      const roomsResponse = await fetch(`/api/admin/rooms?storeId=${normalizedInvoice.storeId}`);
      const rooms = await roomsResponse.json();
      const foundRoom = rooms.find((r: Room) => String(r.id || (r as any).Id) === String(normalizedInvoice.roomId));
      setRoom(foundRoom);

      const storesResponse = await fetch('/api/admin/stores');
      const stores = await storesResponse.json();
      const foundStore = stores.find((s: Store) => String(s.id ?? (s as any).Id) === String(normalizedInvoice.storeId));
      setStore(foundStore || null);

      const ordersResponse = await fetch(`/api/orders?sessionId=${normalizedInvoice.roomSessionId}`);
      const items = await ordersResponse.json();
      setInvoice({ ...normalizedInvoice, items: items || [] });
    } catch (error) {
      console.error('Error fetching invoice:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Tính toán ──────────────────────────────────────────────────────────────
  const durationMinutes = invoice
    ? Math.ceil((new Date(invoice.endTime).getTime() - new Date(invoice.startTime).getTime()) / 60000)
    : 0;
  const durationHours = Math.floor(durationMinutes / 60);
  const durationMins = durationMinutes % 60;
  const durationText = durationHours > 0
    ? `${durationHours} giờ ${durationMins > 0 ? `${durationMins} phút` : ''}`.trim()
    : `${durationMinutes} phút`;
  const totalProductCost = (invoice?.items || []).reduce((s: number, i: any) => s + i.price * i.quantity, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-slate-600">Đang tải...</p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center">
        <Card className="bg-slate-100 border-slate-300 p-8 text-center">
          <p className="text-slate-600 mb-4">Không tìm thấy hóa đơn</p>
          <Link href="/dashboard">
            <Button className="bg-blue-600 hover:bg-blue-700">Quay lại</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-100 to-white print:bg-white">

      {/* ── Nút điều khiển (ẩn khi in) ── */}
      <div className="bg-white border-b border-slate-300 sticky top-0 z-40 print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* ← THÊM NÚT QUAY LẠI */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="text-slate-600 hover:text-slate-900 gap-1 px-1 sm:px-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden xs:inline">Quay lại</span>
            </Button>
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate">Hóa Đơn</h1>
          </div>
          <div className="flex gap-1 sm:gap-2">
            <Button onClick={() => window.print()} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1 px-2 sm:px-4">
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">In hóa đơn</span>
            </Button>
          </div>
        </div>
      </div>
      {/* ── Xem trước trên màn hình (ẩn khi in) ── */}
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8 print:hidden">
        <Card className="bg-white sm:bg-slate-100 border-none sm:border-slate-300 p-4 sm:p-8 shadow-sm sm:shadow-none rounded-2xl sm:rounded-3xl">
          <div className="text-center mb-6 sm:mb-8 pb-4 sm:pb-6 border-b border-slate-200 sm:border-slate-300">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">HÓA ĐƠN</h1>
            <p className="text-slate-500 text-xs sm:text-sm font-bold uppercase tracking-widest mt-1">HD{invoice.id.substring(0, 8).toUpperCase()}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8 mb-6 sm:mb-8">
            <div className="bg-slate-50 sm:bg-transparent p-3 sm:p-0 rounded-xl">
              <p className="text-slate-400 text-[10px] sm:text-sm font-bold uppercase tracking-wider mb-1 sm:mb-2">THÔNG TIN PHÒNG</p>
              <p className="text-slate-900 font-black text-lg">Phòng {room?.roomNumber}</p>
              {invoice.customerName && (
                <p className="text-slate-600 text-sm font-medium">Khách: {invoice.customerName}</p>
              )}
            </div>
            <div className="sm:text-right bg-slate-50 sm:bg-transparent p-3 sm:p-0 rounded-xl">
              <p className="text-slate-400 text-[10px] sm:text-sm font-bold uppercase tracking-wider mb-1 sm:mb-2">NGÀY LẬP HÓA ĐƠN</p>
              <p className="text-slate-900 font-bold">{new Date(invoice.createdAt).toLocaleDateString('vi-VN')}</p>
              <p className="text-slate-600 text-sm">{new Date(invoice.createdAt).toLocaleTimeString('vi-VN')}</p>
            </div>
          </div>

          <div className="bg-slate-100 sm:bg-slate-200 p-4 rounded-2xl mb-6 sm:mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 sm:divide-slate-300">
              <div className="pb-3 sm:pb-0">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">BẮT ĐẦU</p>
                <p className="text-slate-900 font-black">{new Date(invoice.startTime).toLocaleTimeString('vi-VN')}</p>
              </div>
              <div className="py-3 sm:py-0 sm:px-4">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">KẾT THÚC</p>
                <p className="text-slate-900 font-black">{new Date(invoice.endTime).toLocaleTimeString('vi-VN')}</p>
              </div>
              <div className="pt-3 sm:pt-0 sm:text-right">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">THỜI LƯỢNG</p>
                <p className="text-indigo-600 font-black">{durationText}</p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full mb-8 min-w-[450px] sm:min-w-0">
              <thead>
                <tr className="border-b border-slate-200 sm:border-slate-300">
                  <th className="text-left py-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">Mục</th>
                  <th className="text-right py-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">SL</th>
                  <th className="text-right py-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">Đơn giá</th>
                  <th className="text-right py-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 text-slate-900">Thuê phòng ({durationText})</td>
                  <td className="text-right text-slate-700">1</td>
                  <td className="text-right text-slate-700">{invoice.roomCost.toLocaleString('vi-VN')} đ</td>
                  <td className="text-right font-semibold text-slate-900">{invoice.roomCost.toLocaleString('vi-VN')} đ</td>
                </tr>
                {(invoice.items || []).map((item: any, index: number) => (
                  <tr key={index} className="border-b border-slate-200">
                    <td className="py-2 text-slate-900">{item.productName}</td>
                    {item.note && <div className="text-[10px] italic text-slate-500">- {item.note}</div>}
                    <td className="text-right text-slate-700">{item.quantity}</td>
                    <td className="text-right text-slate-700">{item.price.toLocaleString('vi-VN')} đ</td>
                    <td className="text-right font-semibold text-slate-900">{(item.price * item.quantity).toLocaleString('vi-VN')} đ</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full max-w-xs">
              <div className="flex justify-between py-3 border-t-2 border-slate-300">
                <span className="font-black text-slate-900 text-sm uppercase tracking-wider mt-1">TỔNG CỘNG</span>
                <span className="font-black text-2xl text-indigo-600">
                  {invoice.totalPrice.toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>
          </div>

          <div className="text-center pt-8 border-t border-slate-300 mt-8">
            <p className="text-slate-600 text-sm">Cảm ơn bạn đã sử dụng dịch vụ!</p>
          </div>
        </Card>
      </div>

      {/* ── Template in 80mm (chỉ hiện khi in) ── */}
      <div className="hidden print:block w-[80mm] mx-auto px-4 pt-2 pb-4 bg-white text-black font-bold"
        style={{
          fontFamily: 'monospace',
          WebkitFontSmoothing: 'none',
          MozOsxFontSmoothing: 'unset',
          textRendering: 'optimizeSpeed'
        }}>
        <style dangerouslySetInnerHTML={{
          __html: `
          @media print { 
            body { -webkit-print-color-adjust: exact; } 
            * { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; text-shadow: none !important; }
            @page { margin: 0; size: 80mm auto; }
          }
        ` }} />
        {/* Tiêu đề */}
        <div className="text-center mb-2" style={{ paddingBottom: 6 }}>
          <h2 className="text-[22px] font-black tracking-wider mt-1">HÓA ĐƠN THANH TOÁN</h2>
          <p className="text-[11px] font-normal">HD{invoice.id.substring(0, 8).toUpperCase()}</p>
          <p className="text-[13px] font-black">PHÒNG: {room?.roomNumber}</p>
          {invoice.customerName && (
            <p className="text-[12px] tracking-wide">Khách: {invoice.customerName}</p>
          )}
          <p className="text-[11px] text-black">{new Date(invoice.createdAt).toLocaleString('vi-VN')}</p>
        </div>
        {/* Bảng chi tiết */}
        <table className="w-full text-[13px] mb-2" style={{ borderCollapse: 'collapse', lineHeight: 1.6 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th className="text-left py-1 text-[11px] tracking-wide uppercase">Chi tiết</th>
              <th className="text-center py-1 text-[11px] tracking-wide">SL</th>
              <th className="text-right py-1 text-[11px] tracking-wide uppercase">T.Tiền</th>
            </tr>
          </thead>
          <tbody>
            {/* Tiền phòng */}
            <tr>
              <td className="py-1.5">
                <div className="font-bold">Tiền phòng</div>
                <div className="text-[11px] font-normal text-black">
                  Giá: {room?.pricePerHour?.toLocaleString('vi-VN')}đ/h
                </div>
                <div className="text-[11px] font-normal text-black italic">
                  {new Date(invoice.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  {' - '}
                  {new Date(invoice.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  {' '}({durationText})
                </div>
              </td>
              <td className="text-center py-1.5">{(durationMinutes / 60).toFixed(2)}</td>
              <td className="text-right py-1.5 font-black">
                {invoice.roomCost.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
              </td>
            </tr>
            {/* Các món */}
            {(invoice.items || []).map((item: any, index: number) => (
              <tr key={index} style={{ borderTop: '1px dashed #000' }}>
                <td className="py-1.5 break-words max-w-[40mm]">
                  <div className="font-bold leading-tight">{item.productName}</div>
                  {item.note && <div className="text-[10px] font-normal italic text-black">Ghi chú: {item.note}</div>}
                  <div className="text-[11px] font-normal text-black">
                    Giá: {item.price.toLocaleString('vi-VN')}
                  </div>
                </td>
                <td className="text-center py-1.5">{item.quantity}</td>
                <td className="text-right py-1.5 font-black">
                  {(item.price * item.quantity).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tổng */}
        <div style={{ paddingTop: 6 }}>
          <div className="flex justify-between text-[12px] font-black" style={{ letterSpacing: '0.5px' }}>
            <span>Tiền phòng:</span>
            <span>{invoice.roomCost.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-[12px] font-black mt-1" style={{ letterSpacing: '0.5px' }}>
            <span>Tổng hàng hóa:</span>
            <span>{totalProductCost.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-[12px] font-black mt-1" style={{ letterSpacing: '0.5px' }}>
            <span>Chiết khấu:</span>
            <span>0%</span>
          </div>
        </div>
        <div className="flex justify-between text-[18px] font-black mt-4 pt-2"
          style={{ borderTop: '2px solid #000', letterSpacing: '0.5px' }}>
          <span>TỔNG CỘNG:</span>
          <span>{invoice.totalPrice.toLocaleString('vi-VN', { maximumFractionDigits: 0 })}</span>
        </div>

        {/* Dòng ghi tay hoa hồng (Không lưu CSDL) */}
        <div className="mt-6 mb-2 flex justify-between text-[13px] font-bold italic pt-2">
        </div>

        {/* Footer */}
        <div className="text-center text-black mt-4"
          style={{ borderTop: '2px dashed #000', paddingTop: 8, fontSize: 11, breakInside: 'avoid' }}>
          <p className="font-black uppercase mb-1">Cảm ơn quý khách!</p>
          <p className="font-normal text-[11px]">Hẹn gặp lại</p>
        </div>
      </div>
    </div >
  );
}