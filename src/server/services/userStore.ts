import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import type { PublicUser, User, UserRole } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';

/** users.json access + password helpers. */

export async function listUsers(): Promise<User[]> {
  return readJSON<User[]>(FILES.users, []);
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  return (await listUsers()).map(toPublicUser);
}

export function toPublicUser(user: User): PublicUser {
  const { password: _password, ...rest } = user;
  return rest;
}

export async function findUserById(id: string): Promise<User | undefined> {
  return (await listUsers()).find((u) => u.id === id);
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const lower = username.trim().toLowerCase();
  return (await listUsers()).find((u) => u.username.toLowerCase() === lower);
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const lower = email.trim().toLowerCase();
  return (await listUsers()).find((u) => (u.email ?? '').toLowerCase() === lower);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export interface CreateUserInput {
  username: string;
  password: string;
  email?: string;
  role?: UserRole;
  avatar?: string;
  googleId?: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const username = input.username.trim();
  if (username.length < 3) {
    throw Object.assign(new Error('Username must be at least 3 characters'), { statusCode: 400 });
  }
  if (input.password && input.password.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters'), { statusCode: 400 });
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    throw Object.assign(new Error('Username already taken'), { statusCode: 409 });
  }

  const users = await listUsers();
  // The very first account always becomes the owner.
  const role: UserRole = input.role ?? (users.length === 0 ? 'owner' : 'user');

  const user: User = {
    id: uuid(),
    username,
    password: input.password ? await hashPassword(input.password) : '',
    email: input.email?.trim() || undefined,
    role,
    avatar: input.avatar,
    googleId: input.googleId,
    createdAt: new Date().toISOString(),
  };

  await updateJSON<User[]>(FILES.users, [], (current) => [...current, user]);
  return user;
}

export async function updateUser(
  id: string,
  patch: Partial<Omit<User, 'id' | 'createdAt'>>,
): Promise<User> {
  let updated: User | undefined;
  await updateJSON<User[]>(FILES.users, [], (current) =>
    current.map((user) => {
      if (user.id !== id) return user;
      updated = { ...user, ...patch, id: user.id, createdAt: user.createdAt };
      return updated;
    }),
  );
  if (!updated) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  return updated;
}

export async function deleteUser(id: string): Promise<void> {
  const user = await findUserById(id);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.role === 'owner') {
    throw Object.assign(new Error('The owner account cannot be deleted'), { statusCode: 403 });
  }
  await updateJSON<User[]>(FILES.users, [], (current) => current.filter((u) => u.id !== id));
}

export function isAdmin(user: { role: UserRole } | undefined | null): boolean {
  return user?.role === 'admin' || user?.role === 'owner';
}
