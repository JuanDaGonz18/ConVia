import { mockVehicles } from '@/data/mock/vehicles';
import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { Vehicle } from '@/types';

const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

export const vehicleService = {
  async getVehicle(vehicleId: string): Promise<Vehicle | undefined> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return undefined;
      return {
        id: data.id,
        ownerId: data.driver_id,
        brand: data.marca,
        model: data.marca,
        plate: data.placa,
        seats: data.puestos,
        color: data.color,
        photoUrl: data.foto_url ?? undefined,
      };
    }

    return mockVehicles.find((vehicle) => vehicle.id === vehicleId);
  },
  async getMyVehicle(): Promise<Vehicle | undefined> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('AUTH_REQUIRED');
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('driver_id', authData.user.id)
        .eq('activo', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return undefined;
      return {
        id: data.id,
        ownerId: data.driver_id,
        brand: data.marca,
        model: data.marca,
        plate: data.placa,
        seats: data.puestos,
        color: data.color,
        photoUrl: data.foto_url ?? undefined,
      };
    }
    return mockVehicles[0];
  },
  async updateVehicle(vehicle: Vehicle): Promise<Vehicle> {
    if (!useSupabase) return vehicle;
    ensureSupabaseConfigured();
    const { data, error } = await supabase
      .from('vehicles')
      .update({
        placa: vehicle.plate.toUpperCase(),
        marca: vehicle.brand,
        color: vehicle.color ?? '',
        puestos: vehicle.seats ?? 1,
      })
      .eq('id', vehicle.id)
      .select('*')
      .single();
    if (error) throw error;
    return {
      id: data.id,
      ownerId: data.driver_id,
      brand: data.marca,
      model: data.marca,
      plate: data.placa,
      seats: data.puestos,
      color: data.color,
      photoUrl: data.foto_url ?? undefined,
    };
  },
  async registerVehicle(vehicle: Vehicle): Promise<Vehicle> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error('AUTH_REQUIRED');

      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          driver_id: authData.user.id,
          placa: vehicle.plate.toUpperCase(),
          marca: vehicle.brand,
          color: vehicle.color ?? '',
          puestos: vehicle.seats ?? 1,
          foto_url: vehicle.photoUrl ?? null,
        })
        .select('*')
        .single();
      if (error) throw error;
      return {
        id: data.id,
        ownerId: data.driver_id,
        brand: data.marca,
        model: data.marca,
        plate: data.placa,
        seats: data.puestos,
        color: data.color,
        photoUrl: data.foto_url ?? undefined,
      };
    }

    return vehicle;
  },
};
