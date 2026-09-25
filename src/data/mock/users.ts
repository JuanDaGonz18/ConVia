import { Driver, Passenger } from '@/types';
import { mockLocations } from '@/data/mock/locations';

export const mockDriver: Driver = {
  id: 'mock-driver-rita-c',
  name: 'Rita C',
  email: 'rita.mock@wheelsapp.demo',
  role: 'driver',
  rating: { score: 4.8, count: 128 },
  vehicleId: 'mock-vehicle-rita',
};

export const mockPassengers: Passenger[] = [
  {
    id: 'mock-passenger-merchito',
    name: 'Merchito',
    email: 'merchito.mock@wheelsapp.demo',
    role: 'client',
    rating: { score: 4.9 },
    pickupLocation: mockLocations[0],
    status: 'waiting',
  },
  {
    id: 'mock-passenger-brandon',
    name: 'Brandon',
    email: 'brandon.mock@wheelsapp.demo',
    role: 'client',
    rating: { score: 4.7 },
    pickupLocation: mockLocations[1],
    status: 'waiting',
  },
];
