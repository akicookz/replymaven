export const HELP_THEME_DEFAULTS = ["system", "light", "dark"] as const;

export type HelpThemeDefault = (typeof HELP_THEME_DEFAULTS)[number];

export function sanitizeHelpThemeDefault(value: unknown): HelpThemeDefault {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function resolveHelpThemeIsDark(
  stored: string | null,
  themeDefault: HelpThemeDefault,
  systemDark: boolean,
): boolean {
  if (stored === "dark") return true;
  if (stored === "light") return false;
  if (themeDefault === "dark") return true;
  if (themeDefault === "light") return false;
  return systemDark;
}

export function helpThemeBootScript(themeDefault: HelpThemeDefault): string {
  const fallback = sanitizeHelpThemeDefault(themeDefault);
  return `(function(){try{var s=localStorage.getItem('rm-help-theme');var d=s==='dark'||(s!=='light'&&(${JSON.stringify(fallback)}==='dark'||(${JSON.stringify(fallback)}!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)));if(d)document.documentElement.classList.add('dark');}catch(e){}document.addEventListener('click',function(e){var t=e.target;var b=t&&t.closest?t.closest('#rm-theme-toggle'):null;if(!b)return;var dk=document.documentElement.classList.toggle('dark');try{localStorage.setItem('rm-help-theme',dk?'dark':'light');}catch(_){}});})();`;
}
