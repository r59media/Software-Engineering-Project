/**
 * R59 Media Admin — Schedule & Availability API Service
 * 
 * Integration layer for schedule slots, weekly availability, and blocked dates.
 * Connected to Cloudflare Workers /schedule and /admin/schedule backend routes.
 */

import { apiClient, ApiClient } from './apiClient';

export interface ScheduleSlot {
  id: string | number;
  date: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  is_booked?: boolean | number;
  isBooked?: boolean;
  booking_id?: string | number | null;
  bookingId?: string | number | null;
  [key: string]: any;
}

export interface GetSlotsParams {
  limit?: number;
  offset?: number;
  [key: string]: any;
}

export interface SlotsApiResponse {
  slots?: ScheduleSlot[];
  [key: string]: any;
}

export interface CreateSlotInput {
  date: string;
  startTime: string;
  endTime: string;
  [key: string]: any;
}

export interface AvailabilityTimeframe {
  start: string;
  end: string;
  [key: string]: any;
}

export interface DayAvailability {
  dayOfWeek: number | string;
  slots: AvailabilityTimeframe[];
  [key: string]: any;
}

export interface WeeklyAvailabilityResponse {
  availability?: DayAvailability[] | any;
  [key: string]: any;
}

export interface BlockedDate {
  id?: string | number;
  date: string;
  reason?: string;
  [key: string]: any;
}

export interface BlockedDatesResponse {
  blockedDates?: BlockedDate[];
  [key: string]: any;
}

export interface AddBlockedDateInput {
  date: string;
  reason?: string;
  [key: string]: any;
}

export interface ScheduleApi {
  getSlots(params?: GetSlotsParams): Promise<ScheduleSlot[]>;
  createSlot(input: CreateSlotInput): Promise<any>;
  deleteSlot(id: string | number): Promise<any>;
  getWeeklyAvailability(): Promise<DayAvailability[] | any | null>;
  saveWeeklyAvailability(availability: DayAvailability[] | any): Promise<any>;
  getBlockedDates(): Promise<BlockedDate[]>;
  addBlockedDate(input: AddBlockedDateInput): Promise<any>;
  removeBlockedDate(id: string | number): Promise<any>;
}

const getClient = (): ApiClient => {
  if (typeof window !== 'undefined' && window.R59?.apiClient) {
    return window.R59.apiClient as ApiClient;
  }
  return apiClient;
};

export const scheduleApi: ScheduleApi = {
  /**
   * Fetch available schedule slots.
   * Established backend endpoint: GET /schedule
   */
  async getSlots({ limit = 100, offset = 0 }: GetSlotsParams = {}): Promise<ScheduleSlot[]> {
    const data = await getClient().get<SlotsApiResponse>('/schedule', { limit, offset });
    return (data && data.slots) || [];
  },

  /**
   * Create a new available timeslot.
   * Established backend endpoint: POST /admin/schedule
   */
  async createSlot({ date, startTime, endTime }: CreateSlotInput): Promise<any> {
    return await getClient().post('/admin/schedule', {
      date,
      start_time: startTime,
      end_time: endTime
    });
  },

  /**
   * Delete an unbooked timeslot.
   * Established backend endpoint: DELETE /admin/schedule/:id
   */
  async deleteSlot(id: string | number): Promise<any> {
    return await getClient().delete(`/admin/schedule/${id}`);
  },

  /**
   * Fetch weekly recurring availability rules.
   * [Pending Agreement]: Proposed endpoint GET /admin/availability
   */
  async getWeeklyAvailability(): Promise<DayAvailability[] | any | null> {
    try {
      const res = await getClient().get<WeeklyAvailabilityResponse>('/admin/availability');
      return res?.availability || null;
    } catch {
      return null;
    }
  },

  /**
   * Save weekly recurring availability rules.
   * [Pending Agreement]: Proposed endpoint PUT /admin/availability
   */
  async saveWeeklyAvailability(availability: DayAvailability[] | any): Promise<any> {
    return await getClient().put('/admin/availability', { availability });
  },

  /**
   * Fetch blocked calendar dates.
   * [Pending Agreement]: Proposed endpoint GET /admin/blocked-dates
   */
  async getBlockedDates(): Promise<BlockedDate[]> {
    try {
      const res = await getClient().get<BlockedDatesResponse>('/admin/blocked-dates');
      return res?.blockedDates || [];
    } catch {
      return [];
    }
  },

  /**
   * Add a blocked calendar date.
   * [Pending Agreement]: Proposed endpoint POST /admin/blocked-dates
   */
  async addBlockedDate({ date, reason }: AddBlockedDateInput): Promise<any> {
    return await getClient().post('/admin/blocked-dates', { date, reason });
  },

  /**
   * Remove a blocked date.
   * [Pending Agreement]: Proposed endpoint DELETE /admin/blocked-dates/:id
   */
  async removeBlockedDate(id: string | number): Promise<any> {
    return await getClient().delete(`/admin/blocked-dates/${id}`);
  }
};

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {} as any;
  window.R59.scheduleApi = scheduleApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.schedule = scheduleApi;
}

export default scheduleApi;
