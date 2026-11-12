import { Driver, Passenger } from '@/types';
import { mockLocations } from '@/data/mock/locations';

export const mockDriver: Driver = {
  id: 'mock-driver-sofia',
  name: 'Sofía Pérez',
  email: 'sofia.demo@example.com',
  role: 'driver',
  rating: { score: 4.8, count: 128 },
  vehicleId: 'mock-vehicle-sofia',
};

export const mockPassengers: Passenger[] = [
  {
    id: 'mock-passenger-mateo',
    name: 'Mateo Ruiz',
    email: 'mateo.demo@example.com',
    role: 'client',
    rating: { score: 4.9 },
    pickupLocation: mockLocations[0],
    status: 'waiting',
  },
  {
    id: 'mock-passenger-valeria',
    name: 'Valeria Cruz',
    email: 'valeria.demo@example.com',
    role: 'client',
    rating: { score: 4.7 },
    pickupLocation: mockLocations[1],
    status: 'waiting',
  },
];
