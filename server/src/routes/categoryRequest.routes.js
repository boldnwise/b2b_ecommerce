const { Router } = require('express')
const ctrl = require('../controllers/categoryRequestController.js')
const { authenticate } = require('../middleware/authenticate.js')
const { authorizeWorkspace } = require('../middleware/requireSubscription.js')
const { validate } = require('../middleware/validate.js')
const { uuidIdParam } = require('../validators/common.validator.js')
const { createCategoryRequestBody } = require('../validators/categoryRequest.validator.js')

const router = Router()

// Seller workspace: role SELLER, ADMIN, or an active seller subscription.
router.use(authenticate, authorizeWorkspace('SELLER'))

router.get('/',               ctrl.listMyRequests)
router.get('/approved',       ctrl.listApproved)
router.get('/unread-count',   ctrl.unreadCount)
router.post('/', validate(createCategoryRequestBody), ctrl.createRequest)
router.patch('/:id/read', validate(uuidIdParam, 'params'), ctrl.markRead)
router.patch('/mark-all-read', ctrl.markAllRead)

module.exports = router
