// Boolean env switches (CC_HUD_NO_COST, CC_HUD_NO_REFRESH, …): any value turns
// the switch on except the conventional "off" spellings — "", "0", "false".
export function envFlag(name: string): boolean {
  const v = process.env[name];
  if (v == null) return false;
  const s = v.trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false';
}
