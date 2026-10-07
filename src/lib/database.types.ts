export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assistant_messages: {
        Row: {
          autor: Database["public"]["Enums"]["message_author"]
          contenido: string
          created_at: string
          id: string
          trip_id: string | null
          user_id: string
        }
        Insert: {
          autor: Database["public"]["Enums"]["message_author"]
          contenido: string
          created_at?: string
          id?: string
          trip_id?: string | null
          user_id: string
        }
        Update: {
          autor?: Database["public"]["Enums"]["message_author"]
          contenido?: string
          created_at?: string
          id?: string
          trip_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          created_at: string
          identity_verified_at: string | null
          review_notes: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["driver_status"]
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          identity_verified_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          identity_verified_at?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      face_templates: {
        Row: {
          created_at: string
          embedding: number[]
          kind: string
          model: string
          user_id: string
        }
        Insert: {
          created_at?: string
          embedding: number[]
          kind?: string
          model?: string
          user_id: string
        }
        Update: {
          created_at?: string
          embedding?: number[]
          kind?: string
          model?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      face_verifications: {
        Row: {
          created_at: string
          error: string | null
          id: string
          provider: string | null
          purpose: string | null
          score: number | null
          selfie_path: string | null
          status: Database["public"]["Enums"]["verification_status"]
          template_kind: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          provider?: string | null
          purpose?: string | null
          score?: number | null
          selfie_path?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          template_kind?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          provider?: string | null
          purpose?: string | null
          score?: number | null
          selfie_path?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          template_kind?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_drivers: {
        Row: {
          created_at: string
          driver_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_drivers_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_drivers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          activo: boolean
          created_at: string
          dominio: string
          id: string
          nombre: string
          tipo: Database["public"]["Enums"]["community_type"]
        }
        Insert: {
          activo?: boolean
          created_at?: string
          dominio: string
          id?: string
          nombre: string
          tipo: Database["public"]["Enums"]["community_type"]
        }
        Update: {
          activo?: boolean
          created_at?: string
          dominio?: string
          id?: string
          nombre?: string
          tipo?: Database["public"]["Enums"]["community_type"]
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string
          trip_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id: string
          trip_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          features: string[]
          limits: Json
          name: string
          tier: string
          updated_at: string
        }
        Insert: {
          features?: string[]
          limits?: Json
          name: string
          tier: string
          updated_at?: string
        }
        Update: {
          features?: string[]
          limits?: Json
          name?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          expo_push_token: string | null
          face_reference_path: string | null
          id: string
          institution_id: string | null
          nombre: string
          notifications_enabled: boolean
          onboarding_completed: boolean
          rating_avg: number
          rating_count: number
          rating_driver_avg: number
          rating_driver_count: number
          rating_passenger_avg: number
          rating_passenger_count: number
          rol: Database["public"]["Enums"]["user_role"]
          telefono: string | null
          terms_accepted_at: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          expo_push_token?: string | null
          face_reference_path?: string | null
          id: string
          institution_id?: string | null
          nombre?: string
          notifications_enabled?: boolean
          onboarding_completed?: boolean
          rating_avg?: number
          rating_count?: number
          rating_driver_avg?: number
          rating_driver_count?: number
          rating_passenger_avg?: number
          rating_passenger_count?: number
          rol?: Database["public"]["Enums"]["user_role"]
          telefono?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          expo_push_token?: string | null
          face_reference_path?: string | null
          id?: string
          institution_id?: string | null
          nombre?: string
          notifications_enabled?: boolean
          onboarding_completed?: boolean
          rating_avg?: number
          rating_count?: number
          rating_driver_avg?: number
          rating_driver_count?: number
          rating_passenger_avg?: number
          rating_passenger_count?: number
          rol?: Database["public"]["Enums"]["user_role"]
          telefono?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          comentario: string | null
          created_at: string
          id: string
          rated_id: string
          rated_role: Database["public"]["Enums"]["user_role"]
          rater_id: string
          score: number
          trip_id: string
        }
        Insert: {
          comentario?: string | null
          created_at?: string
          id?: string
          rated_id: string
          rated_role: Database["public"]["Enums"]["user_role"]
          rater_id: string
          score: number
          trip_id: string
        }
        Update: {
          comentario?: string | null
          created_at?: string
          id?: string
          rated_id?: string
          rated_role?: Database["public"]["Enums"]["user_role"]
          rater_id?: string
          score?: number
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_rated_id_fkey"
            columns: ["rated_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_searches: {
        Row: {
          created_at: string
          id: string
          texto: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          texto: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          texto?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recent_searches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          address: string
          created_at: string
          id: string
          kind: string
          label: string
          lat: number
          lng: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string
          created_at?: string
          id?: string
          kind: string
          label: string
          lat: number
          lng: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          lat?: number
          lng?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tier_fkey"
            columns: ["tier"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["tier"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_locations: {
        Row: {
          eta_next_stop_seconds: number | null
          heading: number | null
          lat: number
          lng: number
          trip_id: string
          updated_at: string
        }
        Insert: {
          eta_next_stop_seconds?: number | null
          heading?: number | null
          lat: number
          lng: number
          trip_id: string
          updated_at?: string
        }
        Update: {
          eta_next_stop_seconds?: number | null
          heading?: number | null
          lat?: number
          lng?: number
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_locations_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: true
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_requests: {
        Row: {
          boarded_at: string | null
          created_at: string
          direccion: string
          estado: Database["public"]["Enums"]["request_status"]
          hora_aprox: string | null
          id: string
          lat: number | null
          lng: number | null
          pago: string | null
          pago_marcado_at: string | null
          passenger_id: string
          qr_token: string
          responded_at: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          boarded_at?: string | null
          created_at?: string
          direccion: string
          estado?: Database["public"]["Enums"]["request_status"]
          hora_aprox?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          pago?: string | null
          pago_marcado_at?: string | null
          passenger_id: string
          qr_token?: string
          responded_at?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          boarded_at?: string | null
          created_at?: string
          direccion?: string
          estado?: Database["public"]["Enums"]["request_status"]
          hora_aprox?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          pago?: string | null
          pago_marcado_at?: string | null
          passenger_id?: string
          qr_token?: string
          responded_at?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_requests_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_requests_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_requests_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_updates: {
        Row: {
          changed_by: string
          changes: string[]
          created_at: string
          id: string
          kind: string
          recipients: string[] | null
          trip_id: string
        }
        Insert: {
          changed_by: string
          changes: string[]
          created_at?: string
          id?: string
          kind?: string
          recipients?: string[] | null
          trip_id: string
        }
        Update: {
          changed_by?: string
          changes?: string[]
          created_at?: string
          id?: string
          kind?: string
          recipients?: string[] | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_updates_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_updates_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "available_trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_updates_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          cupos_totales: number
          descripcion: string | null
          destino_lat: number | null
          destino_lng: number | null
          destino_nombre: string
          driver_id: string
          estado: Database["public"]["Enums"]["trip_status"]
          finished_at: string | null
          id: string
          institution_id: string | null
          origen_lat: number | null
          origen_lng: number | null
          origen_nombre: string
          precio: number
          ruta: Json | null
          salida_at: string
          sector: string | null
          started_at: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          cupos_totales: number
          descripcion?: string | null
          destino_lat?: number | null
          destino_lng?: number | null
          destino_nombre: string
          driver_id: string
          estado?: Database["public"]["Enums"]["trip_status"]
          finished_at?: string | null
          id?: string
          institution_id?: string | null
          origen_lat?: number | null
          origen_lng?: number | null
          origen_nombre: string
          precio: number
          ruta?: Json | null
          salida_at: string
          sector?: string | null
          started_at?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          cupos_totales?: number
          descripcion?: string | null
          destino_lat?: number | null
          destino_lng?: number | null
          destino_nombre?: string
          driver_id?: string
          estado?: Database["public"]["Enums"]["trip_status"]
          finished_at?: string | null
          id?: string
          institution_id?: string | null
          origen_lat?: number | null
          origen_lng?: number | null
          origen_nombre?: string
          precio?: number
          ruta?: Json | null
          salida_at?: string
          sector?: string | null
          started_at?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          activo: boolean
          color: string
          created_at: string
          driver_id: string
          foto_url: string | null
          id: string
          marca: string
          placa: string
          puestos: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          color: string
          created_at?: string
          driver_id: string
          foto_url?: string | null
          id?: string
          marca: string
          placa: string
          puestos: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          color?: string
          created_at?: string
          driver_id?: string
          foto_url?: string | null
          id?: string
          marca?: string
          placa?: string
          puestos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      available_trips: {
        Row: {
          created_at: string | null
          cupos_disponibles: number | null
          cupos_totales: number | null
          descripcion: string | null
          destino_lat: number | null
          destino_lng: number | null
          destino_nombre: string | null
          driver_avatar_url: string | null
          driver_id: string | null
          driver_nombre: string | null
          driver_rating: number | null
          estado: Database["public"]["Enums"]["trip_status"] | null
          finished_at: string | null
          id: string | null
          institution_id: string | null
          origen_lat: number | null
          origen_lng: number | null
          origen_nombre: string | null
          precio: number | null
          ruta: Json | null
          salida_at: string | null
          sector: string | null
          started_at: string | null
          updated_at: string | null
          vehicle_color: string | null
          vehicle_foto_url: string | null
          vehicle_id: string | null
          vehicle_marca: string | null
          vehicle_placa: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      board_passenger: {
        Args: { p_qr_token: string }
        Returns: {
          boarded_at: string | null
          created_at: string
          direccion: string
          estado: Database["public"]["Enums"]["request_status"]
          hora_aprox: string | null
          id: string
          lat: number | null
          lng: number | null
          pago: string | null
          pago_marcado_at: string | null
          passenger_id: string
          qr_token: string
          responded_at: string | null
          trip_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trip_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_trip: { Args: { p_trip_id: string }; Returns: Json }
      cancel_trip_request: {
        Args: { p_request_id: string }
        Returns: {
          boarded_at: string | null
          created_at: string
          direccion: string
          estado: Database["public"]["Enums"]["request_status"]
          hora_aprox: string | null
          id: string
          lat: number | null
          lng: number | null
          pago: string | null
          pago_marcado_at: string | null
          passenger_id: string
          qr_token: string
          responded_at: string | null
          trip_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trip_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_email_domain: {
        Args: { p_email: string }
        Returns: {
          dominio: string
          institution_id: string
          nombre: string
          tipo: Database["public"]["Enums"]["community_type"]
        }[]
      }
      finish_trip: { Args: { p_trip_id: string }; Returns: Json }
      get_my_plan: {
        Args: never
        Returns: {
          current_period_end: string
          features: string[]
          limits: Json
          name: string
          status: string
          tier: string
        }[]
      }
      rate_trip_passenger: {
        Args: { p_comment?: string; p_request_id: string; p_score: number }
        Returns: undefined
      }
      respond_trip_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: {
          boarded_at: string | null
          created_at: string
          direccion: string
          estado: Database["public"]["Enums"]["request_status"]
          hora_aprox: string | null
          id: string
          lat: number | null
          lng: number | null
          pago: string | null
          pago_marcado_at: string | null
          passenger_id: string
          qr_token: string
          responded_at: string | null
          trip_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "trip_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_passenger_payment: {
        Args: { p_paid: boolean; p_request_id: string }
        Returns: undefined
      }
      set_verification_result: {
        Args: {
          p_error?: string
          p_score?: number
          p_status: Database["public"]["Enums"]["verification_status"]
          p_verification_id: string
        }
        Returns: undefined
      }
      start_trip: {
        Args: { p_trip_id: string }
        Returns: {
          created_at: string
          cupos_totales: number
          descripcion: string | null
          destino_lat: number | null
          destino_lng: number | null
          destino_nombre: string
          driver_id: string
          estado: Database["public"]["Enums"]["trip_status"]
          finished_at: string | null
          id: string
          institution_id: string | null
          origen_lat: number | null
          origen_lng: number | null
          origen_nombre: string
          precio: number
          ruta: Json | null
          salida_at: string
          sector: string | null
          started_at: string | null
          updated_at: string
          vehicle_id: string
        }
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_face_embedding: {
        Args: { p_embedding: number[]; p_purpose?: string }
        Returns: Json
      }
      submit_license_face: { Args: { p_embedding: number[] }; Returns: Json }
      switch_role: {
        Args: { p_rol: Database["public"]["Enums"]["user_role"] }
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string
          expo_push_token: string | null
          face_reference_path: string | null
          id: string
          institution_id: string | null
          nombre: string
          notifications_enabled: boolean
          onboarding_completed: boolean
          rating_avg: number
          rating_count: number
          rating_driver_avg: number
          rating_driver_count: number
          rating_passenger_avg: number
          rating_passenger_count: number
          rol: Database["public"]["Enums"]["user_role"]
          telefono: string | null
          terms_accepted_at: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trip_members: { Args: { p_trip_id: string }; Returns: Json }
      update_trip: {
        Args: {
          p_cupos_totales: number
          p_descripcion: string
          p_destino_lat: number
          p_destino_lng: number
          p_destino_nombre: string
          p_origen_lat: number
          p_origen_lng: number
          p_origen_nombre: string
          p_precio: number
          p_ruta?: Json
          p_salida_at: string
          p_trip_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      community_type: "universidad" | "empresa"
      driver_status: "pendiente" | "aprobado" | "rechazado" | "suspendido"
      message_author: "usuario" | "asistente"
      request_status:
        | "pendiente"
        | "aceptado"
        | "negado"
        | "abordado"
        | "cancelado"
      trip_status:
        | "por_empezar"
        | "en_curso"
        | "finalizado"
        | "cancelado"
        | "no_iniciado"
      user_role: "usuario" | "conductor"
      verification_status: "pendiente" | "procesando" | "verificado" | "fallido"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      community_type: ["universidad", "empresa"],
      driver_status: ["pendiente", "aprobado", "rechazado", "suspendido"],
      message_author: ["usuario", "asistente"],
      request_status: [
        "pendiente",
        "aceptado",
        "negado",
        "abordado",
        "cancelado",
      ],
      trip_status: [
        "por_empezar",
        "en_curso",
        "finalizado",
        "cancelado",
        "no_iniciado",
      ],
      user_role: ["usuario", "conductor"],
      verification_status: ["pendiente", "procesando", "verificado", "fallido"],
    },
  },
} as const
