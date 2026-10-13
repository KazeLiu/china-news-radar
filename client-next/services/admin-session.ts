let token = '';
export const getAdminToken = () => token;
export function setAdminToken(value: string) { token = value; }
export function adminHeaders(): Record<string, string> { return token ? { 'X-Admin-Token': token } : {}; }
