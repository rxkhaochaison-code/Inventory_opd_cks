import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { DashboardStats } from './components/DashboardStats';
import { DashboardCharts } from './components/DashboardCharts';
import { InventoryTable } from './components/InventoryTable';
import { DrugModal } from './components/DrugModal';
import { DispenseModal } from './components/DispenseModal';
import { ImportModal } from './components/ImportModal';
import { DispenseHistoryModal } from './components/DispenseHistoryModal';
import { GasSetupModal } from './components/GasSetupModal';
import { LoginScreen } from './components/LoginScreen';
import { DrugItem, DispenseRecord, GasConfig, TelegramConfig } from './types/inventory';
import { StorageService } from './services/storageService';
import { GasApiService } from './services/gasApiService';
import { TelegramService } from './services/telegramService';
import { generateGoogleAppsScriptCode } from './services/gasCodeTemplate';
import { exportDrugsToExcel, downloadExcelTemplate } from './services/fileParser';
import { GoogleSheetsDirectService } from './services/googleSheetsDirectService';
import { initAuth, googleSignIn, getAccessToken } from './services/googleAuthService';
import { SyncConfirmModal } from './components/SyncConfirmModal';
import { User } from 'firebase/auth';
import { CheckCircle2, AlertTriangle, Trash2, Copy, FileSpreadsheet, ExternalLink } from 'lucide-react';

const SHEET_ID = '1z4wlxHJlRdMPEubDenBDAyrqOlwpCBphu5FY5APUwjQ';

const GAS_CONFIG: GasConfig = {
  sheetId: SHEET_ID,
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxKRcFl73ckyd5zFc6dWvpz0WgxVdGKOAuJvU-zZJ2kfING9ShQhdNf53rEfIhRIqR5vA/exec',
  folderId: '1O8MiCSQ43f2aoI7HvcPPY4EM97szYqlb',
  autoSync: true,
  lastSyncTime: null,
};

export default function App() {
  // Authentication State (Persistent login so user doesn't need to re-login every round)
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    return localStorage.getItem('kcs_auth_user') || sessionStorage.getItem('kcs_auth_user');
  });

  // Google OAuth State
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [isGoogleConnecting, setIsGoogleConnecting] = useState(false);
  const [isSyncConfirmModalOpen, setIsSyncConfirmModalOpen] = useState(false);

  // State
  const [drugs, setDrugs] = useState<DrugItem[]>([]);
  const [dispenseRecords, setDispenseRecords] = useState<DispenseRecord[]>([]);

  // Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    status: 'idle' | 'syncing' | 'success' | 'error';
    errorText?: string;
    lastTime?: string | null;
  }>({
    status: 'idle',
    lastTime: null,
  });

  // Filter state
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Modals state
  const [isDrugModalOpen, setIsDrugModalOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<DrugItem | null>(null);

  const [isDispenseModalOpen, setIsDispenseModalOpen] = useState(false);
  const [dispenseTargetDrug, setDispenseTargetDrug] = useState<DrugItem | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isGasModalOpen, setIsGasModalOpen] = useState(false);
  const [gasModalInitialTab, setGasModalInitialTab] = useState<'config' | 'code' | 'telegram' | 'guide'>('config');
  const [gasConfig, setGasConfig] = useState<GasConfig>(() => StorageService.getGasConfig() || GAS_CONFIG);
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(() => StorageService.getTelegramConfig());

  const [deleteConfirmDrug, setDeleteConfirmDrug] = useState<DrugItem | null>(null);
  const [bulkDeleteDrugs, setBulkDeleteDrugs] = useState<DrugItem[] | null>(null);

  // Toast state
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const updateSyncTimestamp = () => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} น.`;
    setLastSyncTime(timeStr);
    return timeStr;
  };

  // Load initial data and auto-sync with Google Sheet (Direct API prioritized)
  useEffect(() => {
    const loadedDrugs = StorageService.getDrugs();
    setDrugs(loadedDrugs);
    const loadedLogs = StorageService.getDispenseRecords();
    setDispenseRecords(loadedLogs);

    // Initial background sync with Google Sheet
    const runInitialSync = async () => {
      const token = await getAccessToken();
      if (token) {
        // Direct Google Sheets API sync without requiring user to click
        try {
          const directRes = await GoogleSheetsDirectService.fetchDrugs(gasConfig.sheetId);
          if (directRes.success && directRes.items && directRes.items.length > 0) {
            setDrugs(directRes.items);
            StorageService.saveDrugs(directRes.items);
            const t = updateSyncTimestamp();
            setSyncStatus({ status: 'success', lastTime: t });
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, directRes.items).catch(() => {});
            return;
          } else if (directRes.success) {
            // Sheet is empty or initial, auto-push local drugs
            if (loadedDrugs.length > 0) {
              const pushRes = await GoogleSheetsDirectService.syncAllToSheets(gasConfig.sheetId, loadedDrugs);
              if (pushRes.success) {
                const t = updateSyncTimestamp();
                setSyncStatus({ status: 'success', lastTime: t });
              }
            }
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, loadedDrugs).catch(() => {});
            return;
          }
        } catch (err: any) {
          console.warn('Initial direct sheet sync warning:', err);
        }
      }

      // Secondary fallback to GAS Web App
      GasApiService.fetchDrugs(gasConfig)
        .then((res) => {
          if (res.success && res.items && res.items.length > 0) {
            setDrugs(res.items);
            StorageService.saveDrugs(res.items);
            const t = updateSyncTimestamp();
            setSyncStatus({ status: 'success', lastTime: t });
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, res.items).catch(() => {});
          } else if (res.success) {
            autoPushToSheet(loadedDrugs);
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, loadedDrugs).catch(() => {});
          } else {
            setSyncStatus({ status: 'error', errorText: res.error, lastTime: null });
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, loadedDrugs).catch(() => {});
          }
        })
        .catch((err) => {
          setSyncStatus({ status: 'error', errorText: err.message, lastTime: null });
          TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, loadedDrugs).catch(() => {});
        });
    };

    runInitialSync();
  }, [gasConfig.sheetId]);

  // ระบบตรวจสอบสถานะยาอัตโนมัติในเบื้องหลังทุก 2.5 นาที (Auto-check & Auto-notify status changes)
  useEffect(() => {
    const timer = setInterval(async () => {
      const token = await getAccessToken();
      if (token) {
        try {
          const directRes = await GoogleSheetsDirectService.fetchDrugs(gasConfig.sheetId);
          if (directRes.success && directRes.items && directRes.items.length > 0) {
            setDrugs(directRes.items);
            StorageService.saveDrugs(directRes.items);
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, directRes.items).catch(() => {});
            return;
          }
        } catch {}
      }

      GasApiService.fetchDrugs(gasConfig)
        .then((res) => {
          if (res.success && res.items && res.items.length > 0) {
            setDrugs(res.items);
            StorageService.saveDrugs(res.items);
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, res.items).catch(() => {});
          } else {
            const local = StorageService.getDrugs();
            TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, local).catch(() => {});
          }
        })
        .catch(() => {
          const local = StorageService.getDrugs();
          TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, local).catch(() => {});
        });
    }, 150000); // ทุก 2.5 นาที

    return () => clearInterval(timer);
  }, [gasConfig, telegramConfig]);

  // Listen to Google Auth state and auto-connect
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        // Automatically sync on auth restoration if not synced yet
        if (token) {
          GoogleSheetsDirectService.fetchDrugs(gasConfig.sheetId)
            .then((res) => {
              if (res.success && res.items && res.items.length > 0) {
                setDrugs(res.items);
                StorageService.saveDrugs(res.items);
                const t = updateSyncTimestamp();
                setSyncStatus({ status: 'success', lastTime: t });
              }
            })
            .catch(() => {});
        }
      },
      () => {
        setGoogleUser(null);
      }
    );
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [gasConfig.sheetId]);

  // Connect Google account and auto-sync immediately (1-click, no repeated popups)
  const handleConnectGoogle = async () => {
    setIsGoogleConnecting(true);
    try {
      const res = await googleSignIn();
      if (res?.user) {
        setGoogleUser(res.user);
        showToast('success', `เชื่อมต่อ Google (${res.user.email}) สำเร็จ! บันทึกการเชื่อมต่ออัตโนมัติแล้ว`);
        // Immediately sync to the sheet
        setIsSyncing(true);
        setSyncStatus({ status: 'syncing' });
        const syncRes = await GoogleSheetsDirectService.syncAllToSheets(gasConfig.sheetId, drugs);
        if (syncRes.success) {
          const t = updateSyncTimestamp();
          setSyncStatus({ status: 'success', lastTime: t });
          showToast('success', `ส่งข้อมูลยา ${drugs.length} รายการลง Google Sheet สำเร็จเรียบร้อย`);
        } else {
          setSyncStatus({ status: 'error', errorText: syncRes.error });
          showToast('error', syncRes.error || 'ซิงค์ข้อมูลไม่สำเร็จ');
        }
        setIsSyncing(false);
      }
    } catch (err: any) {
      showToast('error', `เชื่อมต่อ Google ไม่สำเร็จ: ${err.message}`);
    } finally {
      setIsGoogleConnecting(false);
    }
  };

  // Disconnect Google account
  const handleDisconnectGoogle = async () => {
    try {
      const { logoutGoogle } = await import('./services/googleAuthService');
      await logoutGoogle();
      setGoogleUser(null);
      showToast('info', 'ตัดการเชื่อมต่อบัญชี Google เรียบร้อยแล้ว');
    } catch (err: any) {
      showToast('error', `ตัดการเชื่อมต่อไม่สำเร็จ: ${err.message}`);
    }
  };

  // Execute sync directly to Google Sheets (after user confirmation)
  const executeSheetSync = async () => {
    setIsSyncing(true);
    setSyncStatus({ status: 'syncing' });
    try {
      const token = await getAccessToken();
      if (!token) {
        setIsSyncConfirmModalOpen(false);
        await handleConnectGoogle();
        return;
      }

      const syncRes = await GoogleSheetsDirectService.syncAllToSheets(gasConfig.sheetId, drugs);
      if (syncRes.success) {
        const t = updateSyncTimestamp();
        setSyncStatus({ status: 'success', lastTime: t });
        showToast('success', `ส่งข้อมูลยา ${drugs.length} รายการลง Google Sheet (ID: ${gasConfig.sheetId}) สำเร็จเรียบร้อย!`);
        setIsSyncConfirmModalOpen(false);
      } else {
        setSyncStatus({ status: 'error', errorText: syncRes.error, lastTime: lastSyncTime });
        showToast('error', syncRes.error || 'ซิงค์ข้อมูลไม่สำเร็จ');
        if (syncRes.needsAuth) {
          setGoogleUser(null);
        }
      }
    } catch (err: any) {
      setSyncStatus({ status: 'error', errorText: err.message, lastTime: lastSyncTime });
      showToast('error', `เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-push updates to Google Sheet in the background without needing user to click sync
  const autoPushToSheet = async (currentDrugs: DrugItem[]) => {
    // 1. Try Direct Google Sheets API if Google user is authenticated
    const token = await getAccessToken();
    if (token) {
      try {
        const directRes = await GoogleSheetsDirectService.syncAllToSheets(gasConfig.sheetId, currentDrugs);
        if (directRes.success) {
          const t = updateSyncTimestamp();
          setSyncStatus({ status: 'success', lastTime: t });
          TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, currentDrugs).catch(() => {});
          return;
        }
      } catch (err: any) {
        console.warn('Direct Google Sheet auto-sync note:', err);
      }
    }

    // 2. Fallback to Google Apps Script Web App
    try {
      const res = await GasApiService.syncAllToGas(gasConfig, currentDrugs);
      if (res.success) {
        const t = updateSyncTimestamp();
        setSyncStatus({ status: 'success', lastTime: t });
      } else {
        setSyncStatus({ status: 'error', errorText: res.error, lastTime: lastSyncTime });
      }
    } catch (err: any) {
      setSyncStatus({ status: 'error', errorText: err.message, lastTime: lastSyncTime });
      console.warn('Auto-sync to Google Sheet note:', err);
    }

    // ตรวจสอบสถานะยาอัตโนมัติและแจ้งเตือนเข้ากลุ่ม Telegram ทันที
    TelegramService.checkAndNotifyStatusChangesAutomatically(telegramConfig, currentDrugs).catch(() => {});
  };

  // Manual Sync Button Handler
  const handleManualSync = async () => {
    // 1. If Google account is connected, open confirmation modal to sync directly
    const token = await getAccessToken();
    if (token) {
      setIsSyncConfirmModalOpen(true);
      return;
    }

    // If not connected with Google yet, prompt Google login first
    showToast('info', 'กำลังเชื่อมต่อบัญชี Google เพื่อซิงค์ข้อมูลลง Google Sheet โดยตรง...');
    handleConnectGoogle();
  };

  const handleLoginSuccess = (user: string) => {
    localStorage.setItem('kcs_auth_user', user);
    sessionStorage.setItem('kcs_auth_user', user);
    setCurrentUser(user);
    showToast('success', `ยินดีต้อนรับ ${user} เข้าสู่ระบบคลังยานอก รพ.เขาชัยสน`);
  };

  const handleLogout = () => {
    localStorage.removeItem('kcs_auth_user');
    sessionStorage.removeItem('kcs_auth_user');
    setCurrentUser(null);
  };

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // If user is not authenticated, render LoginScreen
  if (!currentUser) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  // Save Drug (Add or Edit) - Auto syncs to Google Sheet
  const handleSaveDrug = (drugToSave: DrugItem) => {
    let updatedDrugs: DrugItem[];
    const isEdit = drugs.some((d) => d.id === drugToSave.id);

    if (isEdit) {
      updatedDrugs = drugs.map((d) => (d.id === drugToSave.id ? drugToSave : d));
      showToast('success', `แก้ไขข้อมูล "${drugToSave.name}" เรียบร้อยแล้ว (อัปเดตชีทอัตโนมัติ)`);
    } else {
      updatedDrugs = [drugToSave, ...drugs];
      showToast('success', `เพิ่ม "${drugToSave.name}" เข้าสู่คลังยาเรียบร้อยแล้ว (อัปเดตชีทอัตโนมัติ)`);
    }

    setDrugs(updatedDrugs);
    StorageService.saveDrugs(updatedDrugs);
    setIsDrugModalOpen(false);
    setEditingDrug(null);

    // Auto-sync directly to Google Sheet in background
    autoPushToSheet(updatedDrugs);

    // ส่งแจ้งเตือนเข้า Telegram ทันที
    TelegramService.notifyDrugSaved(telegramConfig, drugToSave, isEdit).catch(() => {});
  };

  // Delete Drug - Auto syncs to Google Sheet
  const handleConfirmDelete = () => {
    if (!deleteConfirmDrug) return;
    const targetId = deleteConfirmDrug.id;
    const targetName = deleteConfirmDrug.name;

    const updatedDrugs = drugs.filter((d) => d.id !== targetId);
    setDrugs(updatedDrugs);
    StorageService.saveDrugs(updatedDrugs);
    setDeleteConfirmDrug(null);
    showToast('info', `ลบรายการยา "${targetName}" ออกจากคลังแล้ว (อัปเดตชีทอัตโนมัติ)`);

    // Auto-sync directly to Google Sheet in background
    autoPushToSheet(updatedDrugs);

    // ส่งแจ้งเตือนการลบเข้า Telegram
    TelegramService.notifyDrugDeleted(telegramConfig, targetName, deleteConfirmDrug.lot).catch(() => {});
  };

  // Bulk Delete Drugs - Auto syncs to Google Sheet
  const handleOpenBulkDelete = (selectedDrugs: DrugItem[]) => {
    if (!selectedDrugs || selectedDrugs.length === 0) return;
    setBulkDeleteDrugs(selectedDrugs);
  };

  const handleConfirmBulkDelete = () => {
    if (!bulkDeleteDrugs || bulkDeleteDrugs.length === 0) return;
    const idsToDelete = new Set(bulkDeleteDrugs.map((d) => d.id));
    const count = bulkDeleteDrugs.length;

    const updatedDrugs = drugs.filter((d) => !idsToDelete.has(d.id));
    setDrugs(updatedDrugs);
    StorageService.saveDrugs(updatedDrugs);
    setBulkDeleteDrugs(null);
    showToast('info', `ลบรายการยาที่เลือก ${count} รายการ เรียบร้อยแล้ว (อัปเดตชีทอัตโนมัติ)`);

    // Auto-sync directly to Google Sheet in background
    autoPushToSheet(updatedDrugs);
    GasApiService.deleteMultipleItemsFromGas(gasConfig, Array.from(idsToDelete)).catch(() => {});

    // ส่งแจ้งเตือนการลบเป็นชุดเข้า Telegram
    TelegramService.notifyDrugDeleted(telegramConfig, '', '', count).catch(() => {});
  };

  // Dispense Drug - Auto syncs to Google Sheet
  const handleConfirmDispense = (record: DispenseRecord) => {
    // Deduct stock
    const updatedDrugs = drugs.map((d) => {
      if (d.id === record.drugId) {
        return {
          ...d,
          quantity: record.remainingAfter,
          updatedAt: new Date().toISOString(),
        };
      }
      return d;
    });

    setDrugs(updatedDrugs);
    StorageService.saveDrugs(updatedDrugs);

    // Save record to history
    const updatedLogs = StorageService.saveDispenseRecord(record);
    setDispenseRecords(updatedLogs);

    setIsDispenseModalOpen(false);
    setDispenseTargetDrug(null);
    showToast('success', `ตัดยอด ${record.amount} ${record.unit} สำหรับ ${record.toDepartment} สำเร็จ (อัปเดตชีทอัตโนมัติ)`);

    // Auto-sync directly to Google Sheet in background
    autoPushToSheet(updatedDrugs);
    GoogleSheetsDirectService.recordDispense(gasConfig.sheetId, record).catch(() => {});
    GasApiService.dispenseItemToGas(gasConfig, record).catch(() => {});

    // ส่งแจ้งเตือนการตัดยอดเข้า Telegram ทันที
    TelegramService.notifyDrugDispensed(telegramConfig, record).catch(() => {});
  };

  // Import Drugs from Excel or PDF - Auto syncs to Google Sheet with smart merge
  const handleImportDrugs = (imported: DrugItem[]) => {
    // Smart merge: Map existing by ID and by Name+Lot
    const existingById = new Map<string, DrugItem>();
    const existingByNameLot = new Map<string, DrugItem>();
    drugs.forEach((d) => {
      existingById.set(d.id, d);
      const key = `${d.name.trim().toLowerCase()}__${d.lot.trim().toLowerCase()}`;
      existingByNameLot.set(key, d);
    });

    const updatedMap = new Map<string, DrugItem>(existingById);
    let updatedCount = 0;
    let addedCount = 0;

    imported.forEach((item, idx) => {
      const nameLotKey = `${item.name.trim().toLowerCase()}__${item.lot.trim().toLowerCase()}`;
      const matchedExisting = (item.id && updatedMap.get(item.id)) || existingByNameLot.get(nameLotKey);

      if (matchedExisting) {
        // Update existing item while preserving original ID
        const targetId = matchedExisting.id;
        updatedMap.set(targetId, {
          ...matchedExisting,
          ...item,
          id: targetId,
          packageUnit: item.packageUnit || matchedExisting.packageUnit || '',
          updatedAt: new Date().toISOString(),
        });
        updatedCount++;
      } else {
        // New item: Ensure unique ID
        const cleanId = item.id || `KCS-IMP-${Date.now().toString().slice(-4)}-${idx + 1}`;
        updatedMap.set(cleanId, {
          ...item,
          id: cleanId,
          updatedAt: new Date().toISOString(),
        });
        addedCount++;
      }
    });

    const finalDrugs = Array.from(updatedMap.values());
    setDrugs(finalDrugs);
    StorageService.saveDrugs(finalDrugs);
    showToast(
      'success',
      `นำเข้าสำเร็จ: เพิ่มใหม่ ${addedCount} รายการ, อัปเดตข้อมูลเดิม ${updatedCount} รายการ (ซิงค์ลงชีทอัตโนมัติ)`
    );

    // Auto-sync directly to Google Sheet in background
    autoPushToSheet(finalDrugs);

    // ส่งสรุปการนำเข้าเข้า Telegram ทันที
    TelegramService.notifyImportSuccess(telegramConfig, addedCount, updatedCount).catch(() => {});
  };

  // Open Edit Modal
  const handleOpenEdit = (drug: DrugItem) => {
    setEditingDrug(drug);
    setIsDrugModalOpen(true);
  };

  // Open Dispense Modal
  const handleOpenDispense = (drug: DrugItem) => {
    setDispenseTargetDrug(drug);
    setIsDispenseModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-['Sarabun',sans-serif] text-slate-800">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-24 right-5 z-50 animate-bounce duration-300">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center space-x-2 text-xs sm:text-sm font-medium ${
              toastMessage.type === 'success'
                ? 'bg-emerald-900 text-white border-emerald-700'
                : toastMessage.type === 'error'
                ? 'bg-rose-900 text-white border-rose-700'
                : 'bg-slate-900 text-white border-slate-700'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
            {toastMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-300" />}
            <span>{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 text-white/70 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header with Sync Button & Auto-sync timestamp */}
      <Header
        sheetId={gasConfig.sheetId}
        isSyncing={isSyncing}
        lastSyncTime={lastSyncTime}
        syncStatus={syncStatus}
        onSync={handleManualSync}
        onOpenGasModal={(tab) => {
          setGasModalInitialTab(tab || 'config');
          setIsGasModalOpen(true);
        }}
        onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
        currentUser={currentUser}
        onLogout={handleLogout}
        googleUser={googleUser}
        onConnectGoogle={handleConnectGoogle}
        isGoogleConnecting={isGoogleConnecting}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Apps Script Guide when sync status has error */}
        {syncStatus.status === 'error' && (
          <div className="bg-amber-50 border border-amber-300 p-4 rounded-2xl shadow-xs text-slate-800 space-y-2">
            <div className="flex items-center space-x-2 text-amber-900 font-bold text-xs sm:text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              <span>การเชื่อมต่อ Google Sheet / Apps Script:</span>
            </div>
            <p className="text-xs text-amber-800">
              {syncStatus.errorText || 'ระบบไม่สามารถซิงค์ข้อมูลกับ Google Sheet ได้ แนะนำให้ตรวจสอบสิทธิ์การเข้าถึง หรือเชื่อมต่อ Google ใหม่อีกครั้ง'}
            </p>
          </div>
        )}
        
        {/* Dashboard Statistics */}
        <DashboardStats
          drugs={drugs}
          activeFilter={activeFilter}
          onFilterChange={(filter) => setActiveFilter(filter)}
        />

        {/* Visual Charts & Analytics */}
        <DashboardCharts
          drugs={drugs}
          onSelectFilter={(filter) => setActiveFilter(filter)}
        />

        {/* Inventory Table and Controls with Drug Status Column and Copy for Sheet */}
        <InventoryTable
          drugs={drugs}
          activeFilter={activeFilter}
          onFilterChange={(filter) => setActiveFilter(filter)}
          onAddDrug={() => {
            setEditingDrug(null);
            setIsDrugModalOpen(true);
          }}
          onEditDrug={handleOpenEdit}
          onDeleteDrug={(drug) => setDeleteConfirmDrug(drug)}
          onDeleteMultipleDrugs={handleOpenBulkDelete}
          onDispenseDrug={handleOpenDispense}
          onOpenImportModal={() => setIsImportModalOpen(true)}
          onExportExcel={() => exportDrugsToExcel(drugs)}
          onDownloadTemplate={downloadExcelTemplate}
          sheetId={gasConfig.sheetId}
        />

      </main>

      {/* Footer */}
      <footer className="bg-emerald-950 text-emerald-300/70 border-t border-emerald-900/60 py-6 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div className="flex items-center space-x-2 flex-wrap justify-center sm:justify-start">
            <span className="font-semibold text-emerald-100">
              ระบบคลังยานอก โรงพยาบาลเขาชัยสน จ.พัทลุง
            </span>
            <span>•</span>
            <a
              href={`https://docs.google.com/spreadsheets/d/${gasConfig.sheetId}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 hover:underline font-mono"
            >
              Google Sheet: {gasConfig.sheetId.slice(0, 15)}...
            </a>
            {lastSyncTime && (
              <span className="text-[11px] bg-emerald-900/80 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-700">
                🟢 อัปเดตชีทล่าสุด {lastSyncTime}
              </span>
            )}
          </div>
          <div className="text-[11px] text-emerald-400/80">
            ระบบติดตามวันหมดอายุ 90 วัน • จุดสั่งซื้อ Min/Max • อัปเดต Google Sheet อัตโนมัติพร้อมคอลัมน์สถานะยา
          </div>
        </div>
      </footer>

      {/* MODALS */}
      {/* 1. Add / Edit Drug Modal */}
      <DrugModal
        isOpen={isDrugModalOpen}
        onClose={() => {
          setIsDrugModalOpen(false);
          setEditingDrug(null);
        }}
        onSave={handleSaveDrug}
        drugToEdit={editingDrug}
      />

      {/* 2. Dispense Modal */}
      <DispenseModal
        isOpen={isDispenseModalOpen}
        onClose={() => {
          setIsDispenseModalOpen(false);
          setDispenseTargetDrug(null);
        }}
        drug={dispenseTargetDrug}
        onConfirmDispense={handleConfirmDispense}
      />

      {/* 3. Import Modal (Excel / PDF) */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportDrugs={handleImportDrugs}
        gasConfig={gasConfig}
      />

      {/* 4. Dispense History Modal */}
      <DispenseHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        records={dispenseRecords}
      />

      {/* 5. Google Apps Script Setup & Status Columns Modal */}
      <GasSetupModal
        isOpen={isGasModalOpen}
        onClose={() => setIsGasModalOpen(false)}
        gasConfig={gasConfig}
        onSaveConfig={(updated) => {
          setGasConfig(updated);
          StorageService.saveGasConfig(updated);
          showToast('success', 'บันทึกการตั้งค่า Google Apps Script เรียบร้อยแล้ว');
        }}
        drugs={drugs}
        onApplyFetchedDrugs={(fetchedDrugs) => {
          setDrugs(fetchedDrugs);
          StorageService.saveDrugs(fetchedDrugs);
          updateSyncTimestamp();
          showToast('success', `ดึงข้อมูลจาก Sheet สำเร็จ (${fetchedDrugs.length} รายการ)`);
        }}
        telegramConfig={telegramConfig}
        onSaveTelegramConfig={(updated) => {
          setTelegramConfig(updated);
          StorageService.saveTelegramConfig(updated);
          showToast('success', 'บันทึกการตั้งค่า Telegram Bot สำเร็จ');
        }}
        initialTab={gasModalInitialTab}
      />

      {/* 6. Delete Confirmation Dialog */}
      {deleteConfirmDrug && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 font-['Prompt']">
                  ยืนยันการลบรายการยา
                </h3>
                <p className="text-xs text-slate-500">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div className="font-bold text-slate-900 text-sm font-['Prompt']">
                {deleteConfirmDrug.name}
              </div>
              <div className="text-slate-600">
                Shelf: <strong>{deleteConfirmDrug.shelf}</strong> | Lot: <strong>{deleteConfirmDrug.lot}</strong>
              </div>
              <div className="text-slate-500">
                คลัง: <strong>{deleteConfirmDrug.subWarehouse}</strong> | แหล่ง: <strong>{deleteConfirmDrug.source}</strong>
              </div>
              <div className="text-slate-500">
                คงเหลือ: <strong>{deleteConfirmDrug.quantity} {deleteConfirmDrug.unit}</strong>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              คุณแน่ใจหรือไม่ว่าต้องการลบรายการยานี้ออกจากระบบคลังยานอก รพ.เขาชัยสน?
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmDrug(null)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
              >
                ยืนยันการลบรายการ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Bulk Delete Confirmation Dialog (ลบหลายรายการพร้อมกัน) */}
      {bulkDeleteDrugs && bulkDeleteDrugs.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-2.5 bg-rose-100 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800 font-['Prompt']">
                  ยืนยันการลบรายการยา {bulkDeleteDrugs.length} รายการ
                </h3>
                <p className="text-xs text-slate-500">การกระทำนี้จะลบรายการยาที่เลือกทั้งหมดและอัปเดต Google Sheet อัตโนมัติ</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              คุณกำลังจะลบรายการยาทั้งหมด <strong>{bulkDeleteDrugs.length} รายการ</strong> ดังต่อไปนี้:
            </p>

            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50 p-2">
              {bulkDeleteDrugs.map((d) => (
                <div key={d.id} className="py-2 px-2 text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{d.name}</div>
                    <div className="text-[11px] text-slate-500">
                      Shelf: <strong>{d.shelf}</strong> | Lot: <strong>{d.lot}</strong> | คลัง: <strong>{d.subWarehouse}</strong>
                    </div>
                  </div>
                  <span className="font-bold text-slate-800 whitespace-nowrap text-right">
                    {d.quantity.toLocaleString()} {d.unit}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-rose-600 font-medium">
              * ข้อมูลจะถูกลบออกจากระบบและ Google Sheet ทันทีโดยไม่สามารถย้อนกลับได้
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeleteDrugs(null)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer"
              >
                ยืนยันการลบ {bulkDeleteDrugs.length} รายการ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Google Sheets Direct Sync Confirmation Modal */}
      <SyncConfirmModal
        isOpen={isSyncConfirmModalOpen}
        onClose={() => setIsSyncConfirmModalOpen(false)}
        onConfirm={executeSheetSync}
        sheetId={gasConfig.sheetId}
        itemCount={drugs.length}
        isLoading={isSyncing}
      />

    </div>
  );
}
