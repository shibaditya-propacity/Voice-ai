export type Role = 'ADMIN' | 'MANAGER';

export type PropertyType = 'APARTMENT' | 'VILLA' | 'COMMERCIAL' | 'PLOT';

export type SiteVisitStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';

export type ConversationRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

export type Language = 'en' | 'hi' | 'mr';

export interface LeadData {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  area?: string;
  budget?: string;
  bhk?: string;
  propertyType?: PropertyType;
  loanRequired?: boolean;
  timeline?: string;
  notes?: string;
}

export interface PropertySearchParams {
  city?: string;
  area?: string;
  minBudget?: number;
  maxBudget?: number;
  bhk?: string;
  propertyType?: PropertyType;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}
