import { DrugItem, DispenseRecord, SourceType, SubWarehouse } from '../types/inventory';
import { getDrugStatus, getSimpleDrugStatus, formatUnitForSheet, parseUnitAndPackage } from '../utils/drugUtils';
import { getAccessToken } from './googleAuthService';

const INVENTORY_HEADERS = [
  'รหัสยา (ID)',
  'ชื่อยา (Drug Name)',
  'Shelf (ชั้นวาง)',
  'Lot No.',
  'บริษัท (Company)',
  'แหล่งที่มา (Source)',
  'คลังย่อย (Sub-warehouse)',
  'วันหมดอายุ (Expiry)',
  'สถานะยา (Drug Status)',
  'คงเหลือ (Qty)',
  'หน่วยนับ (Unit)',
  'หน่วยบรรจุ (Package Unit)',
  'Min (ขั้นต่ำ)',
  'Max (สูงสุด)',
  'สถานะสต็อก (Stock Status)',
  'สรุปการแจ้งเตือน (Alert Summary)',
  'วันที่รับเข้า (Received)',
  'สถานะ (ปลอดภัย/ใกล้หมดอายุ/หมดอายุ/สต็อกถึงเกณฑ์ min)',
  'อัปเดตล่าสุด (Last Updated)',
];

const DISPENSE_HEADERS = [
  'รหัสบันทึก (ID)',
  'วันเวลา (Timestamp)',
  'รหัสยา (Drug ID)',
  'ชื่อยา (Drug Name)',
  'Lot No.',
  'จำนวนที่ตัด (Amount)',
  'หน่วยนับ (Unit)',
  'คลังต้นทาง (From)',
  'แผนกปลายทาง (To)',
  'ผู้บันทึก (User)',
  'เหตุผล (Reason)',
  'คงเหลือหลังตัด (Remaining)',
];

export const GoogleSheetsDirectService = {
  /**
   * ตรวจสอบและสร้างแท็บ "คลังยา" และ "ประวัติตัดยอด" ใน Sheet หากยังไม่มี
   */
  async ensureSheetStructure(
    token: string,
    sheetId: string
  ): Promise<{ success: boolean; error?: string; needsAuth?: boolean }> {
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title,index)`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (metaRes.status === 401) {
        return {
          success: false,
          needsAuth: true,
          error: 'เซสชัน Google หมดอายุ กรุณากดเชื่อมต่อ Google ใหม่อีกครั้ง',
        };
      }

      if (metaRes.status === 403) {
        return {
          success: false,
          error: `บัญชี Google นี้ไม่มีสิทธิ์แก้ไข Google Sheet ID: ${sheetId} — กรุณาเปิด Google Sheet และตั้งค่าแชร์ (Share) สิทธิ์เป็น Editor ให้กับบัญชีของคุณ หรือตั้งค่าเป็น 'ทุกคนที่มีลิงก์มีสิทธิ์แก้ไข'`,
        };
      }

      if (!metaRes.ok) {
        const errJson = await metaRes.json().catch(() => ({}));
        return {
          success: false,
          error:
            errJson?.error?.message ||
            `ไม่สามารถเปิด Google Sheet ID: ${sheetId} ได้ (HTTP ${metaRes.status}) กรุณาตรวจสอบว่าระบุ Sheet ID ถูกต้องและบัญชี Google ของท่านมีสิทธิ์เปิดไฟล์นี้`,
        };
      }

      const meta = await metaRes.json();
      const sheetsList: any[] = meta.sheets || [];
      const existingTitles: string[] = sheetsList.map(
        (s: any) => s?.properties?.title || ''
      );

      const requests: any[] = [];
      let targetKcsSheetId: number | null = null;

      if (!existingTitles.includes('คลังยา')) {
        const firstSheet = sheetsList[0];
        const firstTitle = firstSheet?.properties?.title;
        // หากชีทว่างมีเพียงชีทเดียวชื่อ Sheet1 หรือ แผ่นงาน1 ให้เปลี่ยนชื่อเป็น คลังยา
        if (sheetsList.length === 1 && (firstTitle === 'Sheet1' || firstTitle === 'แผ่นงาน1')) {
          requests.push({
            updateSheetProperties: {
              properties: { sheetId: firstSheet.properties.sheetId, title: 'คลังยา' },
              fields: 'title',
            },
          });
          targetKcsSheetId = firstSheet.properties.sheetId;
        } else {
          requests.push({
            addSheet: { properties: { title: 'คลังยา' } },
          });
        }
      } else {
        const found = sheetsList.find((s: any) => s?.properties?.title === 'คลังยา');
        if (found) targetKcsSheetId = found.properties.sheetId;
      }

      if (!existingTitles.includes('ประวัติตัดยอด')) {
        requests.push({
          addSheet: { properties: { title: 'ประวัติตัดยอด' } },
        });
      }

      // Freeze แถวแรกของคลังยาเพื่อให้อ่านง่าย
      if (targetKcsSheetId !== null && requests.length > 0) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: targetKcsSheetId,
              gridProperties: { frozenRowCount: 1 },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        });
      }

      if (requests.length > 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
        });
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการตรวจสอบชีท' };
    }
  },

  /**
   * ดึงข้อมูลยาทั้งหมดจากแท็บ "คลังยา" ของ Google Sheet ตรงผ่าน REST API
   */
  async fetchDrugs(sheetId: string): Promise<{
    success: boolean;
    items?: DrugItem[];
    error?: string;
    needsAuth?: boolean;
  }> {
    const token = await getAccessToken();
    if (!token) {
      return {
        success: false,
        needsAuth: true,
        error: 'ยังไม่ได้เข้าสู่ระบบ Google หรือไม่มีสิทธิ์เข้าถึง Google Sheets',
      };
    }

    try {
      const structRes = await this.ensureSheetStructure(token, sheetId);
      if (!structRes.success) {
        return { success: false, error: structRes.error };
      }

      const range = encodeURIComponent("'คลังยา'!A1:S");
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          error: errJson?.error?.message || `ไม่สามารถดึงข้อมูลได้ (HTTP ${res.status})`,
        };
      }

      const data = await res.json();
      const rows: any[][] = data.values || [];

      if (rows.length <= 1) {
        return { success: true, items: [] };
      }

      const items: DrugItem[] = [];
      const is19Layout = rows[0].length >= 19;
      const is18Layout = rows[0].length === 18;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;

        let qty = 0;
        let unit = 'เม็ด';
        let packageUnit = '';
        let minVal = 0;
        let maxVal = 0;
        let receivedVal = '';
        let notesVal = '';
        let updatedVal = '';

        if (is19Layout) {
          qty = Number(row[9] || 0);
          unit = String(row[10] || 'เม็ด');
          packageUnit = String(row[11] || '');
          minVal = Number(row[12] || 0);
          maxVal = Number(row[13] || 0);
          receivedVal = String(row[16] || '');
          notesVal = String(row[17] || '');
          updatedVal = String(row[18] || '');
        } else if (is18Layout) {
          qty = Number(row[9] || 0);
          unit = String(row[10] || 'เม็ด');
          minVal = Number(row[11] || 0);
          maxVal = Number(row[12] || 0);
          receivedVal = String(row[15] || '');
          notesVal = String(row[16] || '');
          updatedVal = String(row[17] || '');
        } else {
          qty = Number(row[8] || 0);
          unit = String(row[9] || 'เม็ด');
          minVal = Number(row[10] || 0);
          maxVal = Number(row[11] || 0);
          receivedVal = String(row[12] || '');
          notesVal = String(row[13] || '');
          updatedVal = String(row[14] || '');
        }

        const { unit: cleanUnit, packageUnit: cleanPackage } = parseUnitAndPackage(unit, packageUnit);

        items.push({
          id: String(row[0]),
          name: String(row[1] || ''),
          shelf: String(row[2] || ''),
          lot: String(row[3] || ''),
          company: String(row[4] || ''),
          source: (String(row[5] || 'GPO')) as SourceType,
          subWarehouse: (String(row[6] || 'OPD')) as SubWarehouse,
          expiryDate: String(row[7] || ''),
          quantity: qty,
          unit: cleanUnit,
          packageUnit: cleanPackage,
          min: minVal,
          max: maxVal,
          receivedDate: receivedVal,
          notes: notesVal,
          updatedAt: updatedVal || new Date().toISOString(),
        });
      }

      return { success: true, items };
    } catch (err: any) {
      return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูลจากชีท' };
    }
  },

  /**
   * ส่งข้อมูลยาและสถานะทั้งหมดขึ้น Google Sheet โดยตรงผ่าน Google Sheets REST API
   */
  async syncAllToSheets(
    sheetId: string,
    drugs: DrugItem[]
  ): Promise<{ success: boolean; error?: string; needsAuth?: boolean }> {
    const token = await getAccessToken();
    if (!token) {
      return {
        success: false,
        needsAuth: true,
        error: 'ยังไม่ได้เข้าสู่ระบบ Google หรือไม่มีสิทธิ์เข้าถึง Google Sheets',
      };
    }

    try {
      const structRes = await this.ensureSheetStructure(token, sheetId);
      if (!structRes.success) {
        return { success: false, error: structRes.error, needsAuth: structRes.needsAuth };
      }

      // 1. เคลียร์พื้นที่เดิมในแท็บ "คลังยา"
      const clearRange = encodeURIComponent("'คลังยา'!A1:S");
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // 2. เตรียมชุดข้อมูลแถว 19 คอลัมน์
      const rows: any[][] = [INVENTORY_HEADERS];

      drugs.forEach((drug) => {
        const st = getDrugStatus(drug);
        let expText = '✅ ปลอดภัย';
        if (st.expiryStatus === 'expired') {
          expText = `🚨 หมดอายุแล้ว (เลยมา ${Math.abs(st.daysLeft)} วัน)`;
        } else if (st.expiryStatus === 'near_expiry') {
          expText = `⏳ ใกล้หมดอายุ (เหลือ ${st.daysLeft} วัน)`;
        } else {
          expText = `✅ ปลอดภัย (เหลือ ${st.daysLeft} วัน)`;
        }

        let stockText = '✅ สต็อกปกติ';
        if (drug.quantity <= 0) {
          stockText = '🔴 สต็อกหมด (0)';
        } else if (drug.quantity <= drug.min) {
          stockText = `⚠️ ถึงเกณฑ์ Min หรือต่ำกว่า (${drug.quantity}/${drug.min})`;
        } else if (drug.max > 0 && drug.quantity > drug.max) {
          stockText = `📦 สต็อกเกิน Max (${drug.quantity}/${drug.max})`;
        } else {
          stockText = `✅ สต็อกปกติ (${drug.quantity})`;
        }

        let alertSummaryText = '🟢 ปกติ';
        if (st.expiryStatus === 'expired') {
          alertSummaryText = '🔴 หมดอายุแล้ว (ต้องทำลาย/ส่งคืน)';
        } else if (st.expiryStatus === 'near_expiry' && st.stockStatus === 'low') {
          alertSummaryText = '⚡ วิกฤต: ใกล้หมดอายุ & ต่ำกว่า Min';
        } else if (st.expiryStatus === 'near_expiry') {
          alertSummaryText = '🟡 ใกล้หมดอายุ (≤ 90 วัน)';
        } else if (st.stockStatus === 'low') {
          alertSummaryText = '🟠 ถึงเกณฑ์ Min (ต้องสั่งเพิ่ม)';
        }

        const simpleStatus = getSimpleDrugStatus(drug);
        const formattedUnit = formatUnitForSheet(drug.unit, drug.packageUnit);

        rows.push([
          drug.id,
          drug.name,
          drug.shelf,
          drug.lot,
          drug.company || '',
          drug.source || '',
          drug.subWarehouse || '',
          drug.expiryDate,
          expText,
          drug.quantity,
          formattedUnit,
          drug.packageUnit || '',
          drug.min,
          drug.max || '',
          stockText,
          alertSummaryText,
          drug.receivedDate || '',
          simpleStatus.text,
          new Date().toISOString(),
        ]);
      });

      // 3. เขียนข้อมูลลงในชีท A1:S
      const writeRange = encodeURIComponent("'คลังยา'!A1:S");
      const writeRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${writeRange}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: "'คลังยา'!A1:S",
            majorDimension: 'ROWS',
            values: rows,
          }),
        }
      );

      if (writeRes.status === 401) {
        return {
          success: false,
          needsAuth: true,
          error: 'เซสชัน Google หมดอายุ กรุณาเชื่อมต่อบัญชี Google ใหม่อีกครั้ง',
        };
      }

      if (writeRes.status === 403) {
        return {
          success: false,
          error: `บัญชี Google นี้ไม่มีสิทธิ์เขียนข้อมูลลงชีท ID: ${sheetId} — กรุณาตั้งค่าแชร์ชีทให้เป็นสิทธิ์ Editor`,
        };
      }

      if (!writeRes.ok) {
        const errJson = await writeRes.json().catch(() => ({}));
        return {
          success: false,
          error: errJson?.error?.message || `ไม่สามารถเขียนข้อมูลลงชีทได้ (HTTP ${writeRes.status})`,
        };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'เกิดข้อผิดพลาดในการบันทึกลงชีท' };
    }
  },

  /**
   * บันทึกประวัติการตัดยอดลงแท็บ "ประวัติตัดยอด" ของ Google Sheet
   */
  async recordDispense(
    sheetId: string,
    record: DispenseRecord
  ): Promise<{ success: boolean; error?: string }> {
    const token = await getAccessToken();
    if (!token) return { success: false, error: 'ไม่มี Token สิทธิ์ Google Sheets' };

    try {
      await this.ensureSheetStructure(token, sheetId);

      // ตรวจสอบว่ามีแถวหัวตารางหรือยัง
      const checkRange = encodeURIComponent("'ประวัติตัดยอด'!A1:L1");
      const checkRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${checkRange}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const checkData = await checkRes.json();
      if (!checkData.values || checkData.values.length === 0) {
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${checkRange}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              range: "'ประวัติตัดยอด'!A1:L1",
              majorDimension: 'ROWS',
              values: [DISPENSE_HEADERS],
            }),
          }
        );
      }

      const appendRange = encodeURIComponent("'ประวัติตัดยอด'!A:L");
      const row = [
        record.id,
        record.dispensedAt,
        record.drugId,
        record.drugName,
        record.lot,
        record.amount,
        record.unit,
        record.fromWarehouse,
        record.toDepartment,
        record.requestedBy,
        record.reason || '',
        record.remainingAfter,
      ];

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${appendRange}:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            range: "'ประวัติตัดยอด'!A:L",
            majorDimension: 'ROWS',
            values: [row],
          }),
        }
      );

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
