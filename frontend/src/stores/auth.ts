import { defineStore } from 'pinia';
import { loginRequest } from '../api/auth';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: 'AGENT' | 'SUPERVISOR' | 'ADMIN';
  departmentId: string | null;
  isActive: boolean;
  locale: string;
}

interface AuthState {
  token: string | null;
  currentUser: CurrentUser | null;
}

function loadStoredUser(): CurrentUser | null {
  try {
    const raw = localStorage.getItem('azmcrm_user');
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

function loadStoredToken(): string | null {
  try {
    return localStorage.getItem('azmcrm_token');
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: loadStoredToken(),
    currentUser: loadStoredUser(),
  }),
  getters: {
    isAuthenticated: (state) => !!state.token,
  },
  actions: {
    async login(email: string, password: string) {
      const { token, user } = await loginRequest(email, password);
      this.token = token;
      this.currentUser = user;
      localStorage.setItem('azmcrm_token', token);
      localStorage.setItem('azmcrm_user', JSON.stringify(user));
    },
    logout() {
      this.token = null;
      this.currentUser = null;
      localStorage.removeItem('azmcrm_token');
      localStorage.removeItem('azmcrm_user');
    },
  },
});
