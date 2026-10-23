import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
const scrypt = (password: string, salt: string, length: number, options: import('node:crypto').ScryptOptions) => new Promise<Buffer>((resolve, reject) => derive(password, salt, length, options, (error, key) => error ? reject(error) : resolve(key)));
export const token = () => randomBytes(32).toString('hex');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) as Buffer;
    return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function checkPassword(password: string, hash: string) {
    const [kind, salt, hex] = hash.split('$');
    if (kind !== 'scrypt' || !salt || !hex || hex.length !== 128)
        return false;
    const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) as Buffer;
    return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
