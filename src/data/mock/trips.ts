import { Trip } from '@/types';
import { mockLocations } from '@/data/mock/locations';
import { mockDriver, mockPassengers } from '@/data/mock/users';

export const mockTrips: Trip[] = [
  {
    id: 'mock-trip-001',
    origin: mockLocations[0],
    destination: mockLocations[2],
    departureTime: '08:30 AM',
    price: 12000,
    seatsAvailable: 3,
    driver: mockDriver,
    passengers: mockPassengers,
    status: 'pending',
    description: 'Ruta por la autopista norte hacia Parque 93.',
  },
  {
    id: 'mock-trip-002',
    origin: mockLocations[1],
    destination: mockLocations[0],
    departureTime: '09:15 AM',
    price: 9500,
    seatsAvailable: 2,
    driver: {
      id: 'mock-driver-carlos',
      name: 'Carlos Mendoza',
      email: 'carlos@wheelsapp.com',
      role: 'driver',
      rating: { score: 4.9, count: 85 },
      vehicleId: 'mock-vehicle-carlos',
    },
    passengers: [],
    status: 'accepted',
    description: 'Viaje directo, aire acondicionado y música tranquila.',
  },
  {
    id: 'mock-trip-003',
    origin: mockLocations[2],
    destination: mockLocations[1],
    departureTime: '05:30 PM',
    price: 14000,
    seatsAvailable: 1,
    driver: {
      id: 'mock-driver-andrea',
      name: 'Andrea Gómez',
      email: 'andrea@wheelsapp.com',
      role: 'driver',
      rating: { score: 5.0, count: 210 },
      vehicleId: 'mock-vehicle-andrea',
    },
    passengers: [mockPassengers[0]],
    status: 'driver_arriving',
    description: 'Regreso hacia el norte por la carrera 7ma.',
  },
];
