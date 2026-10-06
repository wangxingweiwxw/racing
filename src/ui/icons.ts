const paths: Record<string, string> = {
  left: '<path d="M39 12 20 32l19 20"/>',
  right: '<path d="m25 12 19 20-19 20"/>',
  pedal: '<path d="M24 10h18v38l7 5v4H16v-7l8-5Z"/><path d="M30 17v22m6-22v22"/>',
  brake: '<path d="M14 8h36l7 7v29L45 56H19L7 44V15Z" fill="#acb0b4" stroke="#92979c" stroke-width="1.5"/><path d="M15 10h34l5 5" stroke="#d8dce0" stroke-width="1.5" opacity=".6"/><rect x="18" y="19" width="28" height="4.5" rx="2.25" fill="#30343b" stroke="none"/><rect x="17" y="29" width="30" height="4.5" rx="2.25" fill="#30343b" stroke="none"/><rect x="22" y="39" width="20" height="4.5" rx="2.25" fill="#30343b" stroke="none"/>',
  bomb: '<circle cx="30" cy="38" r="17"/><path d="m39 22 6-8 8 4m-7-8 3-5m5 20 6-1"/>',
  settings: '<path d="m27 7-2 7-6 3-7-1-5 9 5 5v5l-5 5 5 9 7-1 6 3 2 7h10l2-7 6-3 7 1 5-9-5-5v-5l5-5-5-9-7 1-6-3-2-7Z"/><circle cx="32" cy="32" r="10"/>',
  camera: '<path d="M9 19h32v30H9zM41 28l14-8v28L41 40Z"/><path d="M18 19v-6h14v6"/>',
  reset: '<path d="M17 19a22 22 0 1 1-5 24M8 12v16h16"/>',
  timer: '<circle cx="32" cy="36" r="21"/><path d="M26 6h12m-6 0v9m0 10v12l9 5M48 16l4-4"/>',
};
export function icon(name: string) {
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ""}</svg>`;
}
