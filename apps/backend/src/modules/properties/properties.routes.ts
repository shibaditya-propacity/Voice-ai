import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import {
  getProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
} from './properties.controller.js';

export const propertiesRouter = Router();
propertiesRouter.use(authenticate);
propertiesRouter.get('/', getProperties);
propertiesRouter.get('/:id', getPropertyById);
propertiesRouter.post('/', createProperty);
propertiesRouter.patch('/:id', updateProperty);
propertiesRouter.delete('/:id', deleteProperty);
