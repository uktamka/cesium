/*global define*/
define([
        '../Core/destroyObject',
        '../Core/FAR',
        '../Core/Math',
        '../Core/Quaternion',
        '../Core/Matrix3',
        '../Core/Ellipsoid',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        './CameraEventHandler',
        './CameraEventType',
        './CameraSpindleControllerMode',
        './CameraHelpers'
    ], function(
        destroyObject,
        FAR,
        CesiumMath,
        Quaternion,
        Matrix3,
        Ellipsoid,
        Cartesian3,
        Cartesian4,
        CameraEventHandler,
        CameraEventType,
        CameraSpindleControllerMode,
        CameraHelpers) {
    "use strict";

    var handleZoom = CameraHelpers.handleZoom;
    var maintainInertia = CameraHelpers.maintainInertia;

    /**
     * A type that defines camera behavior: the camera's position and axes will be rotated around the center
     * of the camera's reference frame.
     *
     * @alias CameraSpindleController
     *
     * @param {HTMLCanvasElement} canvas An HTML canvas element used for its dimensions
     * and for listening on user events.
     * @param {Camera} camera The camera to use.
     * @param {Ellipsoid} [ellipsoid=WGS84 Ellipsoid] The ellipsoid to move around.
     *
     * @internalConstructor
     */
    var CameraSpindleController = function(canvas, camera, ellipsoid) {
        ellipsoid = ellipsoid || Ellipsoid.WGS84;

        this._canvas = canvas;
        this._camera = camera;
        this._ellipsoid = ellipsoid;

        /**
         * A parameter in the range <code>[0, 1]</code> used to determine how long
         * the camera will continue to spin because of inertia.
         * With a value of one, the camera will spin forever and
         * with value of zero, the camera will have no inertia.
         *
         * @type Number
         */
        this.inertiaSpin = 0.9;

        /**
         * A parameter in the range <code>[0, 1)</code> used to determine how long
         * the camera will continue to zoom because of inertia.
         * With value of zero, the camera will have no inertia.
         *
         * @type Number
         */
        this.inertiaZoom = 0.8;

        /**
         * If set, the camera will not be able to rotate past this axis in either direction.
         * If this is set while in pan mode, the position clicked on the ellipsoid
         * will not always map directly to the cursor.
         *
         * @type Cartesian3
         *
         * @see CameraSpindleController#mode
         */
        this.constrainedAxis = undefined;

        /**
         * Determines the rotation behavior on mouse events.
         *
         * @type CameraSpindleControllerMode
         */
        this.mode = CameraSpindleControllerMode.AUTO;

        var radius = this._ellipsoid.getMaximumRadius();
        this._zoomFactor = 5.0;
        this._minimumZoomRate = 20.0;
        this._maximumZoomRate = FAR;
        this._rotateFactor = 1.0 / radius;
        this._rotateRateRangeAdjustment = radius;
        this._maximumRotateRate = 1.77;
        this._minimumRotateRate = 1.0 / 5000.0;

        this._spinHandler = new CameraEventHandler(canvas, CameraEventType.LEFT_DRAG);
        this._zoomHandler = new CameraEventHandler(canvas, CameraEventType.RIGHT_DRAG);
        this._zoomWheel = new CameraEventHandler(canvas, CameraEventType.WHEEL);

        this._lastInertiaSpinMovement = undefined;
        this._lastInertiaZoomMovement = undefined;
        this._lastInertiaWheelZoomMovement = undefined;
    };

    /**
     * DOC_TBA
     *
     * @memberof CameraSpindleController
     *
     * @param {Matrix4} transform DOC_TBA
     * @param {Ellipsoid} [ellipsoid=WGS84 Ellipsoid] DOC_TBA
     *
     * @example
     * // Example 1.
     * // Change the reference frame to one centered at a point on the ellipsoid's surface.
     * // Set the spindle controller's ellipsoid to a unit sphere for easy rotation around that point.
     * var center = ellipsoid.cartographicToCartesian(Cartographic.fromDegrees(-75.59777, 40.03883));
     * var transform = Transforms.eastNorthUpToFixedFrame(center);
     * scene.getCamera().getControllers().get(0).setReferenceFrame(transform, Ellipsoid.UNIT_SPHERE);
     *
     * // Example 2.
     * // Reset to the defaults.
     * scene.getCamera().getControllers().get(0).setReferenceFrame(Matrix4.IDENTITY);
     *
     */
    CameraSpindleController.prototype.setReferenceFrame = function (transform, ellipsoid) {
        this._camera.transform = transform;
        this.setEllipsoid(ellipsoid);
    };

    /**
     * Returns the ellipsoid that the camera is moving around.
     *
     * @memberof CameraSpindleController
     *
     * @returns {Ellipsoid} The ellipsoid that the camera is moving around.
     *
     * @see CameraSpindleController#setEllipsoid
     */
    CameraSpindleController.prototype.getEllipsoid = function() {
        return this._ellipsoid;
    };

    /**
     * Sets the ellipsoid that the camera is moving around.
     *
     * @memberof CameraSpindleController
     *
     * @param {Ellipsoid} [ellipsoid=WGS84 Ellipsoid] The ellipsoid that the camera is moving around.
     *
     * @see CameraSpindleController#getEllipsoid
     */
    CameraSpindleController.prototype.setEllipsoid = function(ellipsoid) {
        ellipsoid = ellipsoid || Ellipsoid.WGS84;

        var radius = ellipsoid.getMaximumRadius();
        this._ellipsoid = ellipsoid;
        this._rotateFactor = 1.0 / radius;
        this._rotateRateRangeAdjustment = radius;
    };

    /**
     * @private
     */
    CameraSpindleController.prototype.update = function() {
        var spin = this._spinHandler;
        var rightZoom = this._zoomHandler;
        var wheelZoom = this._zoomWheel;
        var rotating = spin && spin.isMoving() && spin.getMovement();
        var rightZooming = rightZoom && rightZoom.isMoving();
        var wheelZooming = wheelZoom && wheelZoom.isMoving();

        if (rotating) {
            this._spin(spin.getMovement());
        }

        if (spin && !rotating && this.inertiaSpin < 1.0) {
            maintainInertia(spin, this.inertiaSpin, this._spin, this, '_lastInertiaSpinMovement');
        }

        if (rightZooming) {
            this._zoom(rightZoom.getMovement());
        } else if (wheelZooming) {
            this._zoom(wheelZoom.getMovement());
        }

        if (rightZoom && !rightZooming && this.inertiaZoom < 1.0) {
            maintainInertia(rightZoom, this.inertiaZoom, this._zoom, this, '_lastInertiaZoomMovement');
        }

        if (wheelZoom && !wheelZooming && this.inertiaZoom < 1.0) {
            maintainInertia(wheelZoom, this.inertiaZoom, this._zoom, this, '_lastInertiaWheelZoomMovement');
        }

        return true;
    };

    CameraSpindleController.prototype._spin = function(movement) {
        if (this.mode === CameraSpindleControllerMode.AUTO) {
            if (typeof this._camera.pickEllipsoid(movement.startPosition, this._ellipsoid) !== 'undefined') {
                this._pan(movement);
            } else {
                this._rotate(movement);
            }
        } else if (this.mode === CameraSpindleControllerMode.ROTATE) {
            this._rotate(movement);
        } else {
            this._pan(movement);
        }
    };

    CameraSpindleController.prototype._rotate = function(movement) {
        this._camera.controller.constrainedAxis = this.constrainedAxis;
        var position = this._camera.position;
        var rho = position.magnitude();
        var rotateRate = this._rotateFactor * (rho - this._rotateRateRangeAdjustment);

        if (rotateRate > this._maximumRotateRate) {
            rotateRate = this._maximumRotateRate;
        }

        if (rotateRate < this._minimumRotateRate) {
            rotateRate = this._minimumRotateRate;
        }

        var phiWindowRatio = (movement.endPosition.x - movement.startPosition.x) / this._canvas.clientWidth;
        var thetaWindowRatio = (movement.endPosition.y - movement.startPosition.y) / this._canvas.clientHeight;

        var deltaPhi = -rotateRate * phiWindowRatio * Math.PI * 2.0;
        var deltaTheta = -rotateRate * thetaWindowRatio * Math.PI;

        this._camera.controller.rotateRight(deltaPhi);
        this._camera.controller.rotateUp(deltaTheta);
    };

    CameraSpindleController.prototype._pan = function(movement) {
        var camera = this._camera;
        camera.controller.constrainedAxis = this.constrainedAxis;
        var p0 = camera.pickEllipsoid(movement.startPosition, this._ellipsoid);
        var p1 = camera.pickEllipsoid(movement.endPosition, this._ellipsoid);

        if (typeof p0 === 'undefined' || typeof p1 === 'undefined') {
            return;
        }

        var transform = camera.getInverseTransform();
        p0 = Cartesian3.fromCartesian4(transform.multiplyByVector(new Cartesian4(p0.x, p0.y, p0.z, 1.0)));
        p1 = Cartesian3.fromCartesian4(transform.multiplyByVector(new Cartesian4(p1.x, p1.y, p1.z, 1.0)));

        if (typeof this.constrainedAxis === 'undefined') {
            p0 = p0.normalize();
            p1 = p1.normalize();
            var dot = p0.dot(p1);
            var axis = p0.cross(p1);

            if (dot < 1.0 && !axis.equalsEpsilon(Cartesian3.ZERO, CesiumMath.EPSILON14)) { // dot is in [0, 1]
                var angle = -Math.acos(dot);
                camera.controller.rotate(axis, angle);
            }
        } else {
            var startRho = p0.magnitude();
            var startPhi = Math.atan2(p0.y, p0.x);
            var startTheta = Math.acos(p0.z / startRho);

            var endRho = p1.magnitude();
            var endPhi = Math.atan2(p1.y, p1.x);
            var endTheta = Math.acos(p1.z / endRho);

            var deltaPhi = startPhi - endPhi;
            var deltaTheta = startTheta - endTheta;

            var theta = Math.acos(camera.position.z / camera.position.magnitude()) + deltaTheta;
            if (theta < 0 || theta > Math.PI) {
                deltaTheta = 0;
            }

            camera.controller.rotateRight(deltaPhi);
            camera.controller.rotateUp(deltaTheta);
        }
    };

    CameraSpindleController.prototype._zoom = function(movement) {
        handleZoom(this, movement, this._ellipsoid.cartesianToCartographic(this._camera.position).height);
    };

   /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof CameraSpindleController
     *
     * @return {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see CameraSpindleController#destroy
     */
    CameraSpindleController.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Removes mouse and keyboard listeners held by this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof CameraSpindleController
     *
     * @return {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see CameraSpindleController#isDestroyed
     *
     * @example
     * controller = controller && controller.destroy();
     */
    CameraSpindleController.prototype.destroy = function() {
        this._spinHandler = this._spinHandler && this._spinHandler.destroy();
        this._zoomHandler = this._zoomHandler && this._zoomHandler.destroy();
        this._zoomWheel = this._zoomWheel && this._zoomWheel.destroy();
        return destroyObject(this);
    };

    return CameraSpindleController;
});