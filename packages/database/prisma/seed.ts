import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const hashedPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@propertyai.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@propertyai.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });
  console.log('Created admin:', admin.email);

  // Create manager user
  const manager = await prisma.user.upsert({
    where: { email: 'manager@propertyai.com' },
    update: {},
    create: {
      name: 'Sales Manager',
      email: 'manager@propertyai.com',
      password: await bcrypt.hash('manager123', 12),
      role: 'MANAGER',
    },
  });
  console.log('Created manager:', manager.email);

  // Seed Akshay Vista
  const akshayVista = await prisma.property.upsert({
    where: { id: 'seed-akshay-vista' },
    update: {
      availableUnits: 42,
    },
    create: {
      id: 'seed-akshay-vista',
      name: 'Akshay Vista',
      city: 'Pune',
      area: 'Pimple Gurav',
      address: 'Sr. No. 87/1, Kashid Park, Near Swami Samarth Temple, Pimple Gurav, Pune - 411061',
      bhk: '2,2.5,3',
      configurations: ['2 BHK', '2.5 BHK', '3 BHK'],
      propertyType: 'APARTMENT',
      price: 10700000, // starting price 1.07 Cr
      pricePerSqftMin: 8000,
      pricePerSqftMax: 10000,
      description: 'Premium residential project by R. R. Lunkad in Pimple Gurav, Pune. 2 BHK starting ₹1.07 Cr, 3 BHK starting ₹1.38 Cr. RERA approved. Limited 42 units available.',
      developer: 'R. R. Lunkad',
      developerUsp: '45+ years legacy with 35+ delivered projects',
      totalUnits: 78,
      availableUnits: 42,
      towers: 1,
      floors: 13,
      landArea: '0.7 Acres',
      openSpace: '75%',
      reraApproved: true,
      launchDate: 'January 2024',
      possessionDate: 'April 2027',
      amenities: [
        "Children's Play Area", 'Yoga & Meditation Zone', 'Senior Citizen Zone',
        'Air-conditioned Gymnasium', 'Jogging & Walking Track', 'Provision for EV Charging',
        'Solar Water Heating System', 'Multi-level Parking', 'CCTV Surveillance',
        'Video Door Phone', 'Organic Waste Converter', 'Rooftop Lifestyle Amenities',
        'Multipurpose Lawn', 'Recreational Deck', 'Meditation Deck', 'Seating Areas',
      ],
      nearbyLandmarks: ['Swami Samarth Temple', 'Hinjewadi IT Park', 'Bhosari Metro', 'Vallabh Nagar Metro'],
      nearbySchools: ['SNBP International School', 'PK International School'],
      nearbyHospitals: ['DY Patil Hospital'],
      nearbyMalls: ['Vision Flora', 'Silver 9 Mall', 'Phoenix Mall'],
      rentalYield: '3% to 4%',
      projectUsp: [
        'Strong focus on privacy', 'Premium architectural planning',
        'Excellent connectivity to Hinjewadi IT Park', 'Spacious layouts',
        'Limited inventory — only 42 units available', 'RERA approved',
        '75% open space', '45+ year legacy developer',
      ],
      bookingAmount: '10% of Agreement Value at booking',
    },
  });
  console.log('Created/updated property:', akshayVista.name);

  // Create sample leads
  const leads = [
    {
      phone: '+919876543210',
      name: 'Amit Sharma',
      city: 'Mumbai',
      area: 'Andheri',
      budget: '1.5 Cr',
      bhk: '3',
      propertyType: 'APARTMENT' as const,
      timeline: '3 months',
      loanRequired: true,
      leadScore: 100,
    },
    {
      phone: '+919876543211',
      name: 'Priya Patel',
      city: 'Pune',
      area: 'Baner',
      budget: '80L',
      bhk: '2',
      propertyType: 'APARTMENT' as const,
      timeline: '6 months',
      loanRequired: false,
      leadScore: 80,
    },
    {
      phone: '+919876543212',
      name: 'Rahul Kumar',
      city: 'Bangalore',
      budget: '2 Cr',
      leadScore: 40,
    },
  ];

  for (const lead of leads) {
    await prisma.lead.upsert({
      where: { phone: lead.phone },
      update: {},
      create: lead,
    });
    console.log('Created lead:', lead.name ?? lead.phone);
  }

  console.log('Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
