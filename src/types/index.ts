export type UserRole = 'client' | 'driver';

export type TripStatus =
  | 'pending'
  | 'accepted'
  | 'driver_arriving'
  | 'started'
  | 'completed'
  | 'cancelled';

// ─── Face Verification States ───────────────────────────────────────────────

/** Estado de la pantalla de verificación facial */
export type FaceVerificationState =
  | 'IDLE'
  | 'CAMERA_PERMISSION'
  | 'DETECTING_FACE'
  | 'FACE_DETECTED'
  | 'POSITIONING'
  | 'LIVENESS'
  | 'CAPTURING'
  | 'GENERATING_EMBEDDING'
  | 'PROCESSING'
  | 'MATCHING'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRY'
  | 'BLOCKED';

/** Alias legacy usado en appStore */
export type FaceVerificationStatus =
  | 'idle'
  | 'processing'
  | 'verified'
  | 'failed'
  | 'retry';

/** Tipo de verificación que desencadena el flujo */
export type FaceVerificationTrigger =
  | 'register'       // primera captura durante el registro
  | 'trip_request'   // pasajero solicita un viaje
  | 'driver_activate'; // conductor se pone disponible

/** Resultado devuelto por el backend tras la verificación completa */
export type FaceVerificationResult = {
  verified: boolean;
  livenessPassed: boolean;
  faceMatched: boolean;
  similarity: number;
  sessionId?: string;
  faceReferenceId?: string;
  failureReason?: FaceVerificationFailureReason;
};

/** Razones específicas de fallo */
export type FaceVerificationFailureReason =
  | 'camera_permission_denied'
  | 'no_face_detected'
  | 'multiple_faces_detected'
  | 'poor_image_quality'
  | 'face_not_centered'
  | 'poor_lighting'
  | 'eyes_not_visible'
  | 'liveness_failed'
  | 'face_mismatch'
  | 'embedding_unavailable'
  | 'too_many_attempts'
  | 'storage_error';

/** Payload para registrar la referencia facial durante el registro */
export type FaceRegisterPayload = {
  userId: string;
  imageBase64: string;
};

/** Payload para iniciar verificación previa a un viaje */
export type FaceVerifyStartPayload = {
  userId: string;
  trigger: FaceVerificationTrigger;
};

export type FaceVerifyCompletePayload = FaceRegisterPayload & {
  trigger: FaceVerificationTrigger;
};

// ─── Core Types ──────────────────────────────────────────────────────────────

export type Location = {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
};

export type Rating = {
  score: number;
  count?: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  // Face verification fields
  faceVerified?: boolean;
  faceReferenceId?: string;
  faceVerifiedAt?: string;
};

export type Driver = User & {
  role: 'driver';
  rating: Rating;
  vehicleId: string;
};

export type Passenger = User & {
  role: 'client';
  rating?: Rating;
  pickupLocation?: Location;
  status?: 'waiting' | 'validated' | 'on_board' | 'completed';
};

export type Vehicle = {
  id: string;
  ownerId: string;
  brand: string;
  model: string;
  plate: string;
  color?: string;
  photoUrl?: string;
};

export type Trip = {
  id: string;
  origin: Location;
  destination: Location;
  departureTime: string;
  price: number;
  seatsAvailable: number;
  driver: Driver;
  passengers: Passenger[];
  status: TripStatus;
  description?: string;
};

export type Notification = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isMe: boolean;
};

export type ChatConversation = {
  id: string;
  participantId: string;
  participantName: string;
  participantRole: UserRole;
  participantAvatar?: string;
  vehicleInfo?: string;
  plate?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: ChatMessage[];
};
