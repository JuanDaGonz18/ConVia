import { mockVehicles } from '@/data/mock/vehicles';
import { Vehicle } from '@/types';

export const vehicleService = {
  async getVehicle(vehicleId: string): Promise<Vehicle | undefined> {
    return mockVehicles.find((vehicle) => vehicle.id === vehicleId);
  },
  async registerVehicle(vehicle: Vehicle): Promise<Vehicle> {
    return vehicle;
  },
};
