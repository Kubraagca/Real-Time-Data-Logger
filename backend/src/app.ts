import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import tzoneRoutes from './tzone/tzone.routes';

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'tzone-backend'
  });
});

app.use(tzoneRoutes);

export default app;
