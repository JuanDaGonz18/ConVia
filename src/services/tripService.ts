import { mockTrips } from '@/data/mock/trips';
import { Trip, TripStatus } from '@/types';

export const tripService = {
  async getAvailableTrips(): Promise<Trip[]> {
    return mockTrips;
  },
  async requestTrip(tripId: string): Promise<Trip | undefined> {
    return mockTrips.find((trip) => trip.id === tripId);
  },
  async acceptTrip(tripId: string): Promise<Trip | undefined> {
    return updateMockTripStatus(tripId, 'accepted');
  },
  async cancelTrip(tripId: string): Promise<Trip | undefined> {
    return updateMockTripStatus(tripId, 'cancelled');
  },
};

function updateMockTripStatus(tripId: string, status: TripStatus) {
  const trip = mockTrips.find((item) => item.id === tripId);

  if (!trip) {
    return undefined;
  }

  return { ...trip, status };
}
