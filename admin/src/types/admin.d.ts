export interface AdminState {
  authenticated: boolean
  dirty: boolean
  packages: any[]
  bookings: any[]
  pricing: any
  images: {
    recent: any[]
    gallery: any[]
    about: any[]
    hero: any[]
  }
  slots: any[]
  coupons: any[]
}

export interface R59Global {
  state?: any
  navigation?: any
  apiClient?: any
  packagesApi?: any
  bookingsApi?: any
  paymentsApi?: any
  photographyApi?: any
  scheduleApi?: any
  modal?: any
  notifications?: any
  confirmation?: any
  formValidation?: any
  dashboard?: any
  payments?: any
  photography?: any
  schedule?: any
  webpConverter?: any
  app?: any
  api?: any
}

declare global {
  interface Window {
    R59: R59Global
  }
}
