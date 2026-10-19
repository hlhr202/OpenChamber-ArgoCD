import type { Language } from '../language.js';
/** Reviewed terminology overrides; generated catalogs must not overwrite these. */
export const overrides: Partial<Record<Language, Record<string, string>>> = {
  ar: { '只读': 'للقراءة فقط', '已过期': 'بيانات قديمة', '已过期/暂停': 'بيانات قديمة / متوقف مؤقتًا', '已过期/已停止': 'بيانات قديمة / متوقف', '已过期/未确认当前状态': 'بيانات قديمة؛ الحالة الحالية غير مؤكدة' },
  de: { '只读': 'Schreibgeschützt', '已过期': 'Veraltet', '快照': 'Momentaufnahme', '已过期/暂停': 'Veraltet / pausiert', '已过期/已停止': 'Veraltet / gestoppt', '已过期/未确认当前状态': 'Veraltet; aktueller Zustand nicht bestätigt' },
  fr: { '已过期': 'Périmé', '已过期/暂停': 'Périmé / en pause', '已过期/已停止': 'Périmé / arrêté', '已过期/未确认当前状态': 'Périmé ; état actuel non vérifié' },
  nl: { '已过期': 'Verouderd', '已过期/暂停': 'Verouderd / gepauzeerd', '已过期/已停止': 'Verouderd / gestopt', '已过期/未确认当前状态': 'Verouderd; huidige status niet bevestigd' },
  uk: { '已过期': 'Застаріло', '已过期/暂停': 'Застаріло / призупинено', '已过期/已停止': 'Застаріло / зупинено', '已过期/未确认当前状态': 'Застаріло; поточний стан не підтверджено' },
  es: { '已过期': 'Desactualizado', '已过期/暂停': 'Desactualizado / en pausa', '已过期/已停止': 'Desactualizado / detenido', '已过期/未确认当前状态': 'Desactualizado; estado actual sin verificar' },
  'pt-BR': { '已过期': 'Desatualizado', '已过期/暂停': 'Desatualizado / pausado', '已过期/已停止': 'Desatualizado / parado', '已过期/未确认当前状态': 'Desatualizado; estado atual não verificado' },
  pl: { '已过期': 'Nieaktualne', '已过期/暂停': 'Nieaktualne / wstrzymane', '已过期/已停止': 'Nieaktualne / zatrzymane', '已过期/未确认当前状态': 'Nieaktualne; bieżący stan niezweryfikowany' },
  ja: { '已过期': '期限切れ', '已过期/暂停': '期限切れ / 一時停止', '已过期/已停止': '期限切れ / 停止', '已过期/未确认当前状态': '情報が古く、現在の状態は未確認' },
  tr: { '已过期': 'Güncel değil', '已过期/暂停': 'Güncel değil / duraklatıldı', '已过期/已停止': 'Güncel değil / durduruldu', '已过期/未确认当前状态': 'Güncel değil; mevcut durum doğrulanmadı' },
  he: { '已过期': 'לא מעודכן', '已过期/暂停': 'לא מעודכן / מושהה', '已过期/已停止': 'לא מעודכן / נעצר', '已过期/未确认当前状态': 'לא מעודכן; המצב הנוכחי לא אומת' },
  'zh-TW': { Applications: '應用程式', Management: '管理', Summary: '摘要', Diagnostic: '診斷' },
  ko: { Applications: '애플리케이션', '只读': '읽기 전용', '已过期': '오래된 데이터', '已过期/暂停': '오래됨 / 일시 중지', '已过期/已停止': '오래됨 / 중지', '已过期/未确认当前状态': '오래된 데이터; 현재 상태 미확인' },
};
