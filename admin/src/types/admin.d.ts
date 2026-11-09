interface AdminState {
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

interface R59Global {
  [key: string]: any
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
  headerFold?: any
  passwordReset?: any
  reviewChanges?: any
  settings?: any
  dashboard?: any
  leads?: any
  payments?: any
  photography?: any
  schedule?: any
  webpConverter?: any
  app?: any
  api?: any
}

interface Window {
  R59: R59Global
  R59_API_URL?: string
  APP_CONFIG?: any
}
