/**
 * R59 Media Admin — Bookings API Service
 * 
 * Integration layer for booking retrieval, creation, updates, and cancellations.
 * Connected to Cloudflare Workers /admin/bookings backend route.
 */

import { apiClient, ApiClient } from './apiClient';

export interface Booking {
  id: string | number;
  client_name?: string;
  clientName?: string;
  client_email?: string;
  clientEmail?: string;
  client_phone?: string;
  clientPhone?: string;
  service_id?: string | number;
  serviceId?: string | number;
  package_name?: string;
  packageName?: string;
  date?: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  status?: 'confirmed' | 'pending' | 'cancelled' | 'completed' | string;
  total_amount?: number;
  totalAmount?: number;
  deposit_amount?: number;
  depositAmount?: number;
  notes?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface GetBookingsParams {
  limit?: number;
  offset?: number;
  status?: string;
  [key: string]: any;
}

export interface BookingPayload {
  client_name?: string;
  clientName?: string;
  client_email?: string;
  clientEmail?: string;
  client_phone?: string;
  clientPhone?: string;
  service_id?: string | number;
  serviceId?: string | number;
  date?: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  status?: string;
  notes?: string;
  [key: string]: any;
}

export interface BookingsResponse {
  bookings?: Booking[];
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: any;
}

export interface BookingsApi {
  getBookings(params?: GetBookingsParams): Promise<BookingsResponse | Booking[] | any>;
  createBooking(bookingPayload: BookingPayload): Promise<any>;
  updateBooking(id: string | number, bookingPayload: Partial<BookingPayload>): Promise<any>;
  cancelBooking(id: string | number): Promise<any>;
  deleteBooking(id: string | number): Promise<any>;
}

const getClient = (): ApiClient => {
  if (typeof window !== 'undefined' && window.R59?.apiClient) {
    return window.R59.apiClient as ApiClient;
  }
  return apiClient;
};

export const bookingsApi: BookingsApi = {
  /**
   * Retrieve list of bookings from backend.
   * Established backend endpoint: GET /admin/bookings?limit=&offset=
   */
  async getBookings({ limit = 50, offset = 0 }: GetBookingsParams = {}) {
    const data = await getClient().get('/admin/bookings', { limit, offset });
    return data;
  },

  /**
   * Create a new booking.
   * Note: Pending backend endpoint agreement for manual admin booking creation.
   */
  async createBooking(bookingPayload: BookingPayload) {
    return await getClient().post('/admin/bookings', bookingPayload);
  },

  /**
   * Update an existing booking.
   * Note: Pending backend endpoint agreement.
   */
  async updateBooking(id: string | number, bookingPayload: Partial<BookingPayload>) {
    return await getClient().put(`/admin/bookings/${id}`, bookingPayload);
  },

  /**
   * Cancel an existing booking.
   * Note: Pending backend endpoint agreement.
   */
  async cancelBooking(id: string | number) {
    return await getClient().patch(`/admin/bookings/${id}/cancel`, {});
  },

  /**
   * Permanently delete a cancelled booking record.
   * Note: Pending backend endpoint agreement.
   */
  async deleteBooking(id: string | number) {
    return await getClient().delete(`/admin/bookings/${id}`);
  }
};

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {} as any;
  window.R59.bookingsApi = bookingsApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.bookings = bookingsApi;
}

export default bookingsApi;
