import React from 'react';
import { FileSpreadsheet, AlertCircle, CheckCircle2, X, ExternalLink, Loader2 } from 'lucide-react';

interface SyncConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  sheetId: string;
  itemCount: number;
  isLoading?: boolean;
}

export const SyncConfirmModal: React.FC<SyncConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  sheetId,
  itemCount,
  isLoading = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 text-white px-6 py-5 flex items-center justify-between border-b border-emerald-800/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-800/80 rounded-2xl text-emerald-300 border border-emerald-700">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-['Prompt'] font-bold text-lg text-white">
                ยืนยันการส่งข้อมูลลง Google Sheet
              </h3>
              <p className="text-xs text-emerald-200/80">
                ระบบเชื่อมต่อ Google Workspace Sheets API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 text-emerald-200/70 hover:text-white hover:bg-emerald-800/60 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-950 text-xs sm:text-sm space-y-2">
            <div className="flex items-center space-x-2 font-semibold text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
              <span>ข้อมูลที่จะถูกอัปเดตลง Google Sheet:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-700 pl-2">
              <li>
                รายการยาทั้งหมดในคลัง: <strong className="text-emerald-800">{itemCount} รายการ</strong>
              </li>
              <li>
                โครงสร้าง 19 คอลัมน์ (พร้อมสถานะวันหมดอายุ, สต็อก Min/Max, หน่วยนับ และหน่วยบรรจุ)
              </li>
              <li>
                แท็บปลายทาง: <strong>'คลังยา'</strong> และ <strong>'ประวัติตัดยอด'</strong>
              </li>
            </ul>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800">Google Sheet ID ปลายทาง:</div>
            <div className="font-mono text-[11px] bg-white p-2 rounded-xl border border-slate-200 select-all break-all text-emerald-800">
              {sheetId}
            </div>
            <a
              href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1 text-emerald-700 hover:text-emerald-800 font-medium text-xs pt-0.5"
            >
              <span>เปิดดูไฟล์ Google Sheet ในแท็บใหม่</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="flex items-start space-x-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <p>
              การดำเนินการนี้จะเขียนข้อมูลยาปัจจุบันลงในชีท 'คลังยา' เพื่อให้ข้อมูลในระบบและ Google Sheet ตรงกันอย่างสมบูรณ์
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-200 transition cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white shadow-md shadow-emerald-950/20 transition active:scale-95 flex items-center space-x-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังส่งข้อมูลลง Sheet...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4" />
                <span>ยืนยันและเริ่มส่งข้อมูลลง Sheet</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
