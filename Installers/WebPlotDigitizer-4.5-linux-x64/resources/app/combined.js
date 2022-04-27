/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.initApp = function() { // This is run when the page loads.
    wpd.browserInfo.checkBrowser();
    wpd.layoutManager.initialLayout();
    wpd.handleLaunchArgs();
    wpd.log();
    document.getElementById('loadingCurtain').style.display = 'none';

};

wpd.loadDefaultImage = function() {
    // Need to initialize file manager alongside loading image.
    // TODO: clean up file manager initialization!
    let loadImage = async function() {
        let response = await fetch("start.png");
        let data = await response.blob();
        let metadata = {
            type: "image/png"
        };
        let file = new File([data], "start.png", metadata);
        wpd.imageManager.initializeFileManager([file]);
        wpd.imageManager.loadFromFile(file);
    };
    loadImage();
}

wpd.handleLaunchArgs = function() {
    // fetch a project with specific ID from the backend if a projectid argument is provided:
    let projectid = wpd.args.getValue("projectid");
    if (projectid == null) {
        wpd.loadDefaultImage();
    } else {
        fetch("storage/project/" + projectid + ".tar").then(function(response) {
            if (response.ok) {
                return response.blob();
            } else {
                throw new Error("Can not open project file with ID: " + projectid);
            }
        }).then(function(blob) {
            wpd.saveResume.readProjectFile(blob);
        }).catch((err) => {
            wpd.messagePopup.show(wpd.gettext("invalid-project"), err);
            wpd.loadDefaultImage();
        });
    }
};

document.addEventListener("DOMContentLoaded", wpd.initApp, true);/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd._AutoDetectionDataCounter = 0;

wpd.AutoDetectionData = class {
    constructor() {
        // public
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.fgColor = [0, 0, 255];
        this.bgColor = [255, 255, 255];
        this.mask = new Set();
        this.binaryData = new Set();
        this.colorDetectionMode = 'fg';
        this.colorDistance = 120;
        this.algorithm = null;
        this.name = wpd._AutoDetectionDataCounter++;
    }

    serialize() {
        // if there's no algo, or if the algo was never run (no algoData),
        // then just return null as there's no reason to save this data.
        if (this.algorithm == null) {
            return null;
        }
        let algoData = this.algorithm.serialize();
        if (algoData == null) {
            return null;
        }

        let compressedMask = wpd.rle.encode(Array.from(this.mask.values()).sort((a, b) => {
            return (a - b);
        }));

        return {
            fgColor: this.fgColor,
            bgColor: this.bgColor,
            mask: compressedMask,
            colorDetectionMode: this.colorDetectionMode,
            colorDistance: this.colorDistance,
            algorithm: algoData,
            name: this.name,
            imageWidth: this.imageWidth,
            imageHeight: this.imageHeight
        };
    }

    deserialize(jsonObj) {
        this.fgColor = jsonObj.fgColor;
        this.bgColor = jsonObj.bgColor;
        this.imageWidth = jsonObj.imageWidth;
        this.imageHeight = jsonObj.imageHeight;
        if (jsonObj.mask != null) {
            let uncompressedMaskData = wpd.rle.decode(jsonObj.mask);
            this.mask = new Set();
            for (let i of uncompressedMaskData) {
                this.mask.add(i);
            }
        }
        this.colorDetectionMode = jsonObj.colorDetectionMode;
        this.colorDistance = jsonObj.colorDistance;

        if (jsonObj.algorithm != null) {
            let algoType = jsonObj.algorithm.algoType;
            if (algoType === "AveragingWindowAlgo") {
                this.algorithm = new wpd.AveragingWindowAlgo();
            } else if (algoType === "AveragingWindowWithStepSizeAlgo") {
                this.algorithm = new wpd.AveragingWindowWithStepSizeAlgo();
            } else if (algoType === "BarExtractionAlgo") {
                this.algorithm = new wpd.BarExtractionAlgo();
            } else if (algoType === "BlobDetectorAlgo") {
                this.algorithm = new wpd.BlobDetectorAlgo();
            } else if (algoType === "XStepWithInterpolationAlgo") {
                this.algorithm = new wpd.XStepWithInterpolationAlgo();
            } else if (algoType === "CustomIndependents") {
                this.algorithm = new wpd.CustomIndependents();
            }
            this.algorithm.deserialize(jsonObj.algorithm);
        }

        this.name = jsonObj.name;
    }

    generateBinaryDataFromMask(imageData) {
        this.binaryData = new Set();
        let refColor = this.colorDetectionMode === 'fg' ? this.fgColor : this.bgColor;
        for (let imageIdx of this.mask) {
            let ir = imageData.data[imageIdx * 4];
            let ig = imageData.data[imageIdx * 4 + 1];
            let ib = imageData.data[imageIdx * 4 + 2];
            let ia = imageData.data[imageIdx * 4 + 3];
            if (ia === 0) {
                // for completely transparent part of the image, assume white
                ir = 255;
                ig = 255;
                ib = 255;
            }
            let dist = wpd.dist3d(ir, ig, ib, refColor[0], refColor[1], refColor[2]);
            if (this.colorDetectionMode === 'fg') {
                if (dist <= this.colorDistance) {
                    this.binaryData.add(imageIdx);
                }
            } else {
                if (dist >= this.colorDistance) {
                    this.binaryData.add(imageIdx);
                }
            }
        }
    }

    generateBinaryDataUsingFullImage(imageData) {
        this.binaryData = new Set();
        let refColor = this.colorDetectionMode === 'fg' ? this.fgColor : this.bgColor;
        for (let imageIdx = 0; imageIdx < imageData.data.length; imageIdx++) {
            let ir = imageData.data[imageIdx * 4];
            let ig = imageData.data[imageIdx * 4 + 1];
            let ib = imageData.data[imageIdx * 4 + 2];
            let ia = imageData.data[imageIdx * 4 + 3];
            if (ia === 0) {
                // for completely transparent part of the image, assume white
                ir = 255;
                ig = 255;
                ib = 255;
            }
            let dist = wpd.dist3d(ir, ig, ib, refColor[0], refColor[1], refColor[2]);
            if (this.colorDetectionMode === 'fg') {
                if (dist <= this.colorDistance) {
                    this.binaryData.add(imageIdx);
                }
            } else {
                if (dist >= this.colorDistance) {
                    this.binaryData.add(imageIdx);
                }
            }
        }
    }

    generateBinaryData(imageData) {
        if (this.mask == null || this.mask.size == 0) {
            this.generateBinaryDataUsingFullImage(imageData);
        } else {
            this.generateBinaryDataFromMask(imageData);
        }
    }
};

wpd.GridDetectionData = class {
    constructor() {
        this.mask = {
            xmin: null,
            xmax: null,
            ymin: null,
            ymax: null,
            pixels: []
        };
        this.lineColor = [255, 255, 255];
        this.colorDistance = 10;
        this.gridData = null;
        this.gridMask = {
            xmin: null,
            xmax: null,
            ymin: null,
            ymax: null,
            pixels: new Set()
        };
        this.binaryData = new Set();
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.backupImageData = null;
        this.gridBackgroundMode = true;
    }

    generateBinaryData(imageData) {
        this.binaryData = new Set();
        this.imageWidth = imageData.width;
        this.imageHeight = imageData.height;

        // use the full image if no grid mask is present
        if (this.gridMask.pixels == null || this.gridMask.pixels.size === 0) {
            this.gridMask.pixels = new Set();

            for (let yi = 0; yi < this.imageHeight; yi++) {
                for (let xi = 0; xi < this.imageWidth; xi++) {
                    let img_index = yi * this.imageWidth + xi;
                    let ir = imageData.data[img_index * 4];
                    let ig = imageData.data[img_index * 4 + 1];
                    let ib = imageData.data[img_index * 4 + 2];
                    let ia = imageData.data[img_index * 4 + 3];

                    if (ia === 0) {
                        // assume white color when image is transparent
                        ir = 255;
                        ig = 255;
                        ib = 255;
                    }

                    let dist = wpd.dist3d(this.lineColor[0], this.lineColor[1], this.lineColor[2],
                        ir, ig, ib);

                    if (this.gridBackgroundMode) {
                        if (dist > this.colorDistance) {
                            this.binaryData.add(img_index);
                            this.gridMask.pixels.add(img_index);
                        }
                    } else {
                        if (dist < this.colorDistance) {
                            this.binaryData.add(img_index);
                            this.gridMask.pixels.add(img_index);
                        }
                    }
                }
            }
            this.gridMask.xmin = 0;
            this.gridMask.xmax = this.imageWidth;
            this.gridMask.ymin = 0;
            this.gridMask.ymax = this.imageHeight;
            return;
        }

        for (let img_index of this.gridMask.pixels) {
            let ir = imageData.data[img_index * 4];
            let ig = imageData.data[img_index * 4 + 1];
            let ib = imageData.data[img_index * 4 + 2];
            let ia = imageData.data[img_index * 4 + 3];

            let dist =
                wpd.dist3d(this.lineColor[0], this.lineColor[1], this.lineColor[2], ir, ig, ib);

            if (this.gridBackgroundMode) {
                if (dist > this.colorDistance) {
                    this.binaryData.add(img_index);
                }
            } else {
                if (dist < this.colorDistance) {
                    this.binaryData.add(img_index);
                }
            }
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// calibration info
wpd.Calibration = class {

    constructor(dim) {
        this._dim = dim;
        this._px = [];
        this._py = [];
        this._dimensions = dim == null ? 2 : dim;
        this._dp = [];
        this._selections = [];

        // public:
        this.labels = [];
        this.labelPositions = [];
        this.maxPointCount = 0;
    }

    getCount() {
        return this._px.length;
    }

    getDimensions() {
        return this._dimensions;
    }

    addPoint(pxi, pyi, dxi, dyi, dzi) {
        let plen = this._px.length;
        let dlen = this._dp.length;
        this._px[plen] = pxi;
        this._py[plen] = pyi;
        this._dp[dlen] = dxi;
        this._dp[dlen + 1] = dyi;
        if (this._dimensions === 3) {
            this._dp[dlen + 2] = dzi;
        }
    }

    getPoint(index) {
        if (index < 0 || index >= this._px.length)
            return null;

        return {
            px: this._px[index],
            py: this._py[index],
            dx: this._dp[this._dimensions * index],
            dy: this._dp[this._dimensions * index + 1],
            dz: this._dimensions === 2 ? null : this._dp[this._dimensions * index + 2]
        };
    }

    changePointPx(index, npx, npy) {
        if (index < 0 || index >= this._px.length) {
            return;
        }
        this._px[index] = npx;
        this._py[index] = npy;
    }

    setDataAt(index, dxi, dyi, dzi) {
        if (index < 0 || index >= this._px.length)
            return;
        this._dp[this._dimensions * index] = dxi;
        this._dp[this._dimensions * index + 1] = dyi;
        if (this._dimensions === 3) {
            this._dp[this._dimensions * index + 2] = dzi;
        }
    }

    findNearestPoint(x, y, threshold) {
        threshold = (threshold == null) ? 50 : parseFloat(threshold);
        let minDist = 0;
        let minIndex = -1;

        for (let i = 0; i < this._px.length; i++) {
            let dist = Math.sqrt((x - this._px[i]) * (x - this._px[i]) +
                (y - this._py[i]) * (y - this._py[i]));
            if ((minIndex < 0 && dist <= threshold) || (minIndex >= 0 && dist < minDist)) {
                minIndex = i;
                minDist = dist;
            }
        }
        return minIndex;
    }

    selectPoint(index) {
        if (this._selections.indexOf(index) < 0) {
            this._selections.push(index);
        }
    }

    selectNearestPoint(x, y, threshold) {
        let minIndex = this.findNearestPoint(x, y, threshold);
        if (minIndex >= 0) {
            this.selectPoint(minIndex);
        }
    }

    getSelectedPoints() {
        return this._selections;
    }

    unselectAll() {
        this._selections = [];
    }

    isPointSelected(index) {
        return this._selections.indexOf(index) >= 0;
    }

    dump() {
        console.log(this._px);
        console.log(this._py);
        console.log(this._dp);
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.ColorGroup = (function() {
    var CGroup = function(tolerance) {
        var totalPixelCount = 0,
            averageColor = {
                r: 0,
                g: 0,
                b: 0
            };

        tolerance = tolerance == null ? 100 : tolerance;

        this.getPixelCount = function() {
            return totalPixelCount;
        };

        this.getAverageColor = function() {
            return averageColor;
        };

        this.isColorInGroup = function(r, g, b) {
            if (totalPixelCount === 0) {
                return true;
            }

            var dist = (averageColor.r - r) * (averageColor.r - r) +
                (averageColor.g - g) * (averageColor.g - g) +
                (averageColor.b - b) * (averageColor.b - b);

            return (dist <= tolerance * tolerance);
        };

        this.addPixel = function(r, g, b) {
            averageColor.r = (averageColor.r * totalPixelCount + r) / (totalPixelCount + 1.0);
            averageColor.g = (averageColor.g * totalPixelCount + g) / (totalPixelCount + 1.0);
            averageColor.b = (averageColor.b * totalPixelCount + b) / (totalPixelCount + 1.0);
            totalPixelCount = totalPixelCount + 1;
        };
    };
    return CGroup;
})();

wpd.colorAnalyzer = (function() {
    function getTopColors(imageData) {

        var colorGroupColl = [], // collection of color groups
            pixi, r, g, b, a, groupi, groupMatched, rtnVal = [],
            avColor, tolerance = 120;

        colorGroupColl[0] = new wpd.ColorGroup(tolerance); // initial group

        for (pixi = 0; pixi < imageData.data.length; pixi += 4) {
            r = imageData.data[pixi];
            g = imageData.data[pixi + 1];
            b = imageData.data[pixi + 2];
            a = imageData.data[pixi + 3];
            if (a === 0) {
                r = 255;
                g = 255;
                b = 255;
            }

            groupMatched = false;

            for (groupi = 0; groupi < colorGroupColl.length; groupi++) {
                if (colorGroupColl[groupi].isColorInGroup(r, g, b)) {
                    colorGroupColl[groupi].addPixel(r, g, b);
                    groupMatched = true;
                    break;
                }
            }

            if (!groupMatched) {
                colorGroupColl[colorGroupColl.length] = new wpd.ColorGroup(tolerance);
                colorGroupColl[colorGroupColl.length - 1].addPixel(r, g, b);
            }
        }

        // sort groups
        colorGroupColl.sort(function(a, b) {
            if (a.getPixelCount() > b.getPixelCount()) {
                return -1;
            } else if (a.getPixelCount() < b.getPixelCount()) {
                return 1;
            }
            return 0;
        });

        for (groupi = 0; groupi < colorGroupColl.length; groupi++) {

            avColor = colorGroupColl[groupi].getAverageColor();

            rtnVal[groupi] = {
                r: parseInt(avColor.r, 10),
                g: parseInt(avColor.g, 10),
                b: parseInt(avColor.b, 10),
                pixels: colorGroupColl[groupi].getPixelCount(),
                percentage: 100.0 * colorGroupColl[groupi].getPixelCount() / (0.25 * imageData.data.length)
            };
        }

        return rtnVal;
    }

    return {
        getTopColors: getTopColors
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.Color = class {
    constructor(r = 0, g = 0, b = 0, a = 255) {
        this._r = r;
        this._g = g;
        this._b = b;
        this._a = a;
    }

    toRGBString() {
        return `rgb(${this._r}, ${this._g}, ${this._b})`;
    }

    toRGBAString() {
        return `rgba(${this._r}, ${this._g}, ${this._b}, ${this._a})`;
    }

    serialize() {
        return [this._r, this._g, this._b, this._a];
    }

    getRGB() {
        return [this._r, this._g, this._b];
    }

    deserialize(data) {
        this._r = data[0];
        this._g = data[1];
        this._b = data[2];
        this._a = data[3];
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.ConnectedPoints = class {
    constructor(connectivity) {
        this._connections = [];
        this._selectedConnectionIndex = -1;
        this._selectedPointIndex = -1;
        this._connectivity = connectivity;

        if (wpd.appData.isMultipage()) {
            this.page = 1;
        }
    }

    addConnection(plist) {
        this._connections.push(plist);
    }

    clearAll() {
        this._connections = [];
    }

    getConnectionAt(index) {
        if (index < this._connections.length) {
            return this._connections[index];
        }
    }

    replaceConnectionAt(index, plist) {
        if (index < this._connections.length) {
            this._connections[index] = plist;
        }
    }

    deleteConnectionAt(index) {
        if (index < this._connections.length) {
            this._connections.splice(index, 1);
        }
    }

    connectionCount() {
        return this._connections.length;
    }

    findNearestPointAndConnection(x, y) {
        var minConnIndex = -1,
            minPointIndex = -1,
            minDist, dist, ci, pi;

        for (ci = 0; ci < this._connections.length; ci++) {
            for (pi = 0; pi < this._connections[ci].length; pi += 2) {
                dist = (this._connections[ci][pi] - x) * (this._connections[ci][pi] - x) +
                    (this._connections[ci][pi + 1] - y) * (this._connections[ci][pi + 1] - y);
                if (minPointIndex === -1 || dist < minDist) {
                    minConnIndex = ci;
                    minPointIndex = pi / 2;
                    minDist = dist;
                }
            }
        }

        return {
            connectionIndex: minConnIndex,
            pointIndex: minPointIndex
        };
    }

    selectNearestPoint(x, y) {
        var nearestPt = this.findNearestPointAndConnection(x, y);
        if (nearestPt.connectionIndex >= 0) {
            this._selectedConnectionIndex = nearestPt.connectionIndex;
            this._selectedPointIndex = nearestPt.pointIndex;
        }
    }

    deleteNearestConnection(x, y) {
        var nearestPt = this.findNearestPointAndConnection(x, y);
        if (nearestPt.connectionIndex >= 0) {
            this.deleteConnectionAt(nearestPt.connectionIndex);
        }
    }

    isPointSelected(connectionIndex, pointIndex) {
        if (this._selectedPointIndex === pointIndex &&
            this._selectedConnectionIndex === connectionIndex) {
            return true;
        }
        return false;
    }

    getSelectedConnectionAndPoint() {
        return {
            connectionIndex: this._selectedConnectionIndex,
            pointIndex: this._selectedPointIndex
        };
    }

    unselectConnectionAndPoint() {
        this._selectedConnectionIndex = -1;
        this._selectedPointIndex = -1;
    }

    setPointAt(connectionIndex, pointIndex, x, y) {
        this._connections[connectionIndex][pointIndex * 2] = x;
        this._connections[connectionIndex][pointIndex * 2 + 1] = y;
    }

    getPointAt(connectionIndex, pointIndex) {
        return {
            x: this._connections[connectionIndex][pointIndex * 2],
            y: this._connections[connectionIndex][pointIndex * 2 + 1]
        };
    }
};

wpd.DistanceMeasurement = class extends wpd.ConnectedPoints {
    constructor() {
        super(2);
    }

    getDistance(index) {
        if (index < this._connections.length && this._connectivity === 2) {
            var dist = Math.sqrt((this._connections[index][0] - this._connections[index][2]) *
                (this._connections[index][0] - this._connections[index][2]) +
                (this._connections[index][1] - this._connections[index][3]) *
                (this._connections[index][1] - this._connections[index][3]));
            return dist; // this is in pixels!
        }
    }
};

wpd.AngleMeasurement = class extends wpd.ConnectedPoints {
    constructor() {
        super(3);
    }

    getAngle(index) {
        if (index < this._connections.length && this._connectivity === 3) {

            var ang1 = wpd.taninverse(-(this._connections[index][5] - this._connections[index][3]),
                    this._connections[index][4] - this._connections[index][2]),
                ang2 = wpd.taninverse(-(this._connections[index][1] - this._connections[index][3]),
                    this._connections[index][0] - this._connections[index][2]),
                ang = ang1 - ang2;

            ang = 180.0 * ang / Math.PI;
            ang = ang < 0 ? ang + 360 : ang;
            return ang;
        }
    }
};

wpd.AreaMeasurement = class extends wpd.ConnectedPoints {
    constructor() {
        super(-1); // connectivity can vary here depending on number of points in the polygon
    }

    getArea(index) {
        // return pixel area of polygons
        if (index < this._connections.length) {
            if (this._connections[index].length >= 4) {
                let totalArea = 0.0;
                for (let pi = 0; pi < this._connections[index].length; pi += 2) {

                    let px1 = this._connections[index][pi];
                    let py1 = this._connections[index][pi + 1];

                    let px2 = 0.0;
                    let py2 = 0.0;
                    if (pi <= this._connections[index].length - 4) {
                        px2 = this._connections[index][pi + 2];
                        py2 = this._connections[index][pi + 3];
                    } else {
                        px2 = this._connections[index][0];
                        py2 = this._connections[index][1];
                    }
                    totalArea += (px1 * py2 - px2 * py1);
                }
                totalArea /= 2.0;
                return totalArea;
            }
        }
        return 0;
    }

    getPerimeter(index) {
        if (index < this._connections.length) {
            let totalDist = 0.0;
            let px_prev = 0.0;
            let py_prev = 0.0;
            for (let pi = 0; pi < this._connections[index].length; pi += 2) {
                let px = this._connections[index][pi];
                let py = this._connections[index][pi + 1];
                if (pi >= 2) {
                    totalDist += Math.sqrt((px - px_prev) * (px - px_prev) +
                        (py - py_prev) * (py - py_prev));
                }
                // include the connection between the last and first point in the set (only when >=
                // 2 sides in the polygon):
                if (pi == this._connections[index].length - 2 && pi >= 4) {
                    let px0 = this._connections[index][0];
                    let py0 = this._connections[index][1];
                    totalDist += Math.sqrt((px - px0) * (px - px0) + (py - py0) * (py - py0));
                }
                px_prev = px;
                py_prev = py;
            }
            return totalDist;
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.plotDataProvider = (function() {
    let _ds = null;

    function setDataSource(ds) {
        _ds = ds;
    }

    function getData() {
        var axes = wpd.appData.getPlotData().getAxesForDataset(_ds);

        if (axes instanceof wpd.BarAxes) {
            return getBarAxesData(_ds, axes);
        } else {
            return getGeneralAxesData(_ds, axes);
        }
    }

    function getBarAxesData(dataSeries, axes) {
        const fieldDateFormat = [],
            rawData = [],
            isFieldSortable = [false, true],
            hasMetadata = dataSeries.hasMetadata();

        let fields = ['Label', 'Value'],
            // remove label from metadata
            metaKeys = dataSeries.getMetadataKeys().filter(key => key !== 'label');

        const hasOverrides = metaKeys.indexOf('overrides') > -1;

        if (hasOverrides) {
            // remove label and overrides key
            metaKeys = metaKeys.filter(key => key !== 'overrides');
        }

        const hasPointGroups = dataSeries.hasPointGroups();
        const pointGroupNames = dataSeries.getPointGroups();

        for (let rowi = 0; rowi < dataSeries.getCount(); rowi++) {
            const dataPt = dataSeries.getPixel(rowi);
            const transformedDataPt = axes.pixelToData(dataPt.x, dataPt.y);

            let tupleIdx;
            let groupIdx;
            if (hasPointGroups) {
                tupleIdx = dataSeries.getTupleIndex(rowi);
                groupIdx = dataSeries.getPointGroupIndexInTuple(tupleIdx, rowi);
            }

            rawData[rowi] = [];

            let lab = "Bar" + rowi;

            if (dataPt.metadata != null) {
                lab = dataPt.metadata["label"];
            } else if (hasPointGroups) {
                // for point groups, label each tuple as the bar in the primary group
                // if there isn't a label stored in the metadata
                if (tupleIdx > -1 && groupIdx > -1) {
                    const primaryPt = dataSeries.getPixel(dataSeries.getTuple(tupleIdx)[0]);
                    if (primaryPt.metadata != null) {
                        lab = primaryPt.metadata["label"];
                    } else {
                        lab = "Bar" + tupleIdx;
                    }
                }
            }
            rawData[rowi].push(lab);
            // transformed value
            rawData[rowi].push(transformedDataPt[0]);

            // point groups
            if (hasPointGroups) {
                let groupName = pointGroupNames[groupIdx];
                if (!groupName) {
                    if (groupIdx === -1) {
                        // not in a group
                        groupName = "";
                    } else if (groupIdx === 0) {
                        // unnamed primary group
                        groupName = wpd.gettext("point-group-primary-group");
                    } else {
                        // unnamed non-primary group
                        groupName = `${wpd.gettext("point-group-group")} ${groupIdx}`
                    }
                }
                rawData[rowi].push(tupleIdx);
                rawData[rowi].push(groupName);
            }

            // other metadata
            for (let metadi = 0; metadi < metaKeys.length; metadi++) {
                const key = metaKeys[metadi];
                let ptmetadata = null;
                if (dataPt.metadata != null && dataPt.metadata[key] != null) {
                    ptmetadata = dataPt.metadata[key];
                }
                rawData[rowi].push(ptmetadata);
            }

            // overrides
            if (hasOverrides) {
                const field = 'y';
                let ptoverride = null;
                if (
                    dataPt.metadata != null &&
                    dataPt.metadata.overrides != null &&
                    dataPt.metadata.overrides[field] != null
                ) {
                    ptoverride = dataPt.metadata.overrides[field];
                }
                rawData[rowi].push(ptoverride);
            }
        }

        if (hasPointGroups) {
            // add tuples and groups to fields
            fields = fields.concat("Tuple", "Group");
            isFieldSortable.push(true, true);
        }

        if (metaKeys.length) {
            // add metadata keys to fields
            fields = fields.concat(metaKeys.map(key => {
                isFieldSortable.push(true);
                return wpd.utils.toSentenceCase(key);
            }));
        }

        if (hasOverrides) {
            // add override field labels to fields
            fields = fields.concat(['Value-Override']);

            isFieldSortable.push(true);
        }

        return {
            fields: fields,
            fieldDateFormat: fieldDateFormat,
            rawData: rawData,
            allowConnectivity: false,
            connectivityFieldIndices: [],
            isFieldSortable: isFieldSortable
        };
    }

    function getGeneralAxesData(dataSeries, axes) {
        // 2D XY, Polar, Ternary, Image, Map
        const rawData = [],
            isFieldSortable = [],
            hasMetadata = dataSeries.hasMetadata();

        let fields = axes.getAxesLabels(),
            fieldDateFormat = [],
            connectivityFieldIndices = [],
            metaKeys = dataSeries.getMetadataKeys(),
            metaKeyCount = hasMetadata === true ? metaKeys.length : 0;

        const hasOverrides = metaKeys.indexOf('overrides') > -1;

        if (hasOverrides) {
            // remove overrides key
            metaKeys = metaKeys.filter(key => key !== 'overrides');
            metaKeyCount -= 1;
        }

        const hasPointGroups = dataSeries.hasPointGroups();
        const pointGroupNames = dataSeries.getPointGroups();

        // data points
        for (let rowi = 0; rowi < dataSeries.getCount(); rowi++) {
            const pt = dataSeries.getPixel(rowi);
            const ptData = axes.pixelToData(pt.x, pt.y);
            rawData[rowi] = [];

            // transformed coordinates
            for (let coli = 0; coli < ptData.length; coli++) {
                rawData[rowi].push(ptData[coli]);
            }

            // point groups
            if (hasPointGroups) {
                const tuplei = dataSeries.getTupleIndex(rowi)
                const groupi = dataSeries.getPointGroupIndexInTuple(tuplei, rowi);
                let groupName = pointGroupNames[groupi];
                if (!groupName) {
                    if (groupi === -1) {
                        // not in a group
                        groupName = "";
                    } else if (groupi === 0) {
                        // unnamed primary group
                        groupName = wpd.gettext("point-group-primary-group");
                    } else {
                        // unnamed non-primary group
                        groupName = `${wpd.gettext("point-group-group")} ${groupi}`
                    }
                }
                rawData[rowi].push(tuplei);
                rawData[rowi].push(groupName);
            }

            // metadata
            for (let metadi = 0; metadi < metaKeyCount; metadi++) {
                const key = metaKeys[metadi];
                let ptmetadata = null;
                if (pt.metadata != null && pt.metadata[key] != null) {
                    ptmetadata = pt.metadata[key];
                }
                rawData[rowi].push(ptmetadata);
            }

            // overrides
            if (hasOverrides) {
                for (let fieldi = 0; fieldi < fields.length; fieldi++) {
                    const field = fields[fieldi].toLowerCase();
                    let ptoverride = null;
                    if (
                        pt.metadata != null &&
                        pt.metadata.overrides != null &&
                        pt.metadata.overrides[field] != null
                    ) {
                        ptoverride = pt.metadata.overrides[field];
                    }
                    rawData[rowi].push(ptoverride);
                }
            }
        }

        // field labels
        if (hasPointGroups) {
            fields = fields.concat("Tuple", "Group");
            isFieldSortable.push(true, true);
        }
        if (hasMetadata) {
            fields = fields.concat(metaKeys.map(key => {
                return wpd.utils.toSentenceCase(key);
            }));

            if (hasOverrides) {
                // add override field labels to fields
                fields = fields.concat(axes.getAxesLabels().map(field => {
                    return wpd.utils.toSentenceCase(field) + '-Override';
                }));
            }
        }

        for (let coli = 0; coli < fields.length; coli++) {
            if (coli < axes.getDimensions()) {
                connectivityFieldIndices[coli] = coli;
                if (axes.isDate != null && axes.isDate(coli)) {
                    fieldDateFormat[coli] = axes.getInitialDateFormat(coli);
                }
            }

            isFieldSortable[coli] = true; // all fields are sortable
        }

        return {
            fields: fields,
            fieldDateFormat: fieldDateFormat,
            rawData: rawData,
            allowConnectivity: true,
            connectivityFieldIndices: connectivityFieldIndices,
            isFieldSortable: isFieldSortable
        };
    }

    return {
        setDataSource: setDataSource,
        getData: getData
    };
})();

wpd.measurementDataProvider = (function() {
    let _ms = null;

    function setDataSource(ms) {
        _ms = ms;
    }

    function getData() {
        var fields = [],
            fieldDateFormat = [],
            rawData = [],
            isFieldSortable = [],
            plotData = wpd.appData.getPlotData(),
            axes = plotData.getAxesForMeasurement(_ms),
            isMap = axes != null && (axes instanceof wpd.MapAxes),
            conni;

        if (_ms instanceof wpd.DistanceMeasurement) {
            for (conni = 0; conni < _ms.connectionCount(); conni++) {
                rawData[conni] = [];
                rawData[conni][0] = 'Dist' + conni;
                if (isMap) {
                    rawData[conni][1] = axes.pixelToDataDistance(_ms.getDistance(conni));
                } else {
                    rawData[conni][1] = _ms.getDistance(conni);
                }
            }

            fields = ['Label', 'Distance'];
            isFieldSortable = [false, true];

        } else if (_ms instanceof wpd.AngleMeasurement) {

            for (conni = 0; conni < _ms.connectionCount(); conni++) {
                rawData[conni] = [];
                rawData[conni][0] = 'Theta' + conni;
                rawData[conni][1] = _ms.getAngle(conni);
            }

            fields = ['Label', 'Angle'];
            isFieldSortable = [false, true];

        } else if (_ms instanceof wpd.AreaMeasurement) {

            for (conni = 0; conni < _ms.connectionCount(); conni++) {
                rawData[conni] = [];
                rawData[conni][0] = 'Poly' + conni;
                if (isMap) {
                    rawData[conni][1] = axes.pixelToDataArea(_ms.getArea(conni));
                    rawData[conni][2] = axes.pixelToDataDistance(_ms.getPerimeter(conni));
                } else {
                    rawData[conni][1] = _ms.getArea(conni);
                    rawData[conni][2] = _ms.getPerimeter(conni);
                }
            }

            fields = ['Label', 'Area', 'Perimeter'];
            isFieldSortable = [false, true, true];
        }

        return {
            fields: fields,
            fieldDateFormat: fieldDateFormat,
            rawData: rawData,
            allowConnectivity: false,
            connectivityFieldIndices: [],
            isFieldSortable: isFieldSortable
        };
    }

    return {
        getData: getData,
        setDataSource: setDataSource
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// Data from a series
wpd.Dataset = class {
    constructor(dim) {
        this._dim = dim;
        this._dataPoints = [];
        this._connections = [];
        this._selections = [];
        this._pixelMetadataCount = 0;
        this._pixelMetadataKeys = [];
        this._metadata = {};
        this._groupNames = []; // point group names
        // _tuples is an array of arrays
        // each inner array contains pixel indexes, indexed by group indexes
        this._tuples = [];

        // public:
        this.name = 'Default Dataset';
        this.variableNames = ['x', 'y'];
        this.colorRGB = new wpd.Color(200, 0, 0);
    }

    hasMetadata() {
        return this._pixelMetadataCount > 0;
    }

    setMetadataKeys(metakeys) {
        this._pixelMetadataKeys = metakeys;
    }

    getMetadataKeys() {
        return this._pixelMetadataKeys;
    }

    addPixel(pxi, pyi, mdata) {
        let dlen = this._dataPoints.length;
        this._dataPoints[dlen] = {
            x: pxi,
            y: pyi,
            metadata: mdata
        };
        if (mdata != null) {
            this._pixelMetadataCount++;
        }
        return dlen;
    }

    getPixel(index) {
        return this._dataPoints[index];
    }

    getAllPixels() {
        return this._dataPoints;
    }

    setPixelAt(index, pxi, pyi) {
        if (index < this._dataPoints.length) {
            this._dataPoints[index].x = pxi;
            this._dataPoints[index].y = pyi;
        }
    }

    setMetadataAt(index, mdata) {
        if (index < this._dataPoints.length) {
            if (mdata != null) {
                if (this._dataPoints[index].metadata == null) {
                    this._pixelMetadataCount++;
                }
            } else {
                if (this._dataPoints[index].metadata != null) {
                    this._pixelMetadataCount--;
                }
            }
            this._dataPoints[index].metadata = mdata;
        }
    }

    insertPixel(index, pxi, pyi, mdata) {
        this._dataPoints.splice(index, 0, {
            x: pxi,
            y: pyi,
            metadata: mdata
        });
        if (mdata != null) {
            this._pixelMetadataCount++;
        }
    }

    removePixelAtIndex(index) {
        if (index < this._dataPoints.length) {
            if (this._dataPoints[index].metadata != null) {
                this._pixelMetadataCount--;
            }
            this._dataPoints.splice(index, 1);
        }
    }

    removeLastPixel() {
        let pIndex = this._dataPoints.length - 1;
        this.removePixelAtIndex(pIndex);
        return pIndex;
    }

    findNearestPixel(x, y, threshold) {
        threshold = (threshold == null) ? 50 : parseFloat(threshold);
        let minDist = 0,
            minIndex = -1;
        for (let i = 0; i < this._dataPoints.length; i++) {
            let dist = Math.sqrt((x - this._dataPoints[i].x) * (x - this._dataPoints[i].x) +
                (y - this._dataPoints[i].y) * (y - this._dataPoints[i].y));
            if ((minIndex < 0 && dist <= threshold) || (minIndex >= 0 && dist < minDist)) {
                minIndex = i;
                minDist = dist;
            }
        }
        return minIndex;
    }

    removeNearestPixel(x, y, threshold) {
        let minIndex = this.findNearestPixel(x, y, threshold);
        if (minIndex >= 0) {
            this.removePixelAtIndex(minIndex);
        }
        return minIndex;
    }

    clearAll() {
        this._dataPoints = [];
        this._pixelMetadataCount = 0;
        this._pixelMetadataKeys = [];
        this._metadata = {};
        this._groupNames = [];
        this._tuples = [];
    }

    getCount() {
        return this._dataPoints.length;
    }

    selectPixel(index) {
        if (this._selections.indexOf(index) >= 0) {
            return;
        }
        this._selections.push(index);
    }

    selectPixels(indexes) {
        for (let i = 0; i < indexes.length; i++) {
            this.selectPixel(indexes[i]);
        }
    }

    unselectAll() {
        this._selections = [];
    }

    selectPixelsInRectangle(p1, p2) {
        // define tester functions for each quadrant
        const tester = {
            ne: function(x, y) {
                return x >= p1.x && x <= p2.x && y >= p1.y && y <= p2.y;
            },
            se: function(x, y) {
                return x >= p1.x && x <= p2.x && y <= p1.y && y >= p2.y;
            },
            sw: function(x, y) {
                return x <= p1.x && x >= p2.x && y <= p1.y && y >= p2.y;
            },
            nw: function(x, y) {
                return x <= p1.x && x >= p2.x && y >= p1.y && y <= p2.y;
            }
        };

        // determine directional relationship between p1 and p2
        const xDirection = (p1.x - p2.x) > 0 ? -1 : 1;
        const yDirection = (p1.y - p2.y) > 0 ? 1 : -1;

        // pick tester function based on relationship between p1 and p2
        let direction = null;
        if (yDirection > 0) { // south
            if (xDirection > 0) { // east
                direction = 'se';
            } else { // west
                direction = 'sw';
            }
        } else { // north
            if (xDirection > 0) { // east
                direction = 'ne';
            } else { // west
                direction = 'nw';
            }
        }

        // go through each data point and test if coordinates are inside rectangle
        // defined by p1 and p2
        for (let index = 0; index < this._dataPoints.length; index++) {
            if (tester[direction](this._dataPoints[index].x, this._dataPoints[index].y)) {
                this.selectPixel(index);
            }
        }
    }

    selectNearestPixel(x, y, threshold) {
        let minIndex = this.findNearestPixel(x, y, threshold);
        if (minIndex >= 0) {
            this.selectPixel(minIndex);
        }
        return minIndex;
    }

    selectNextPixel() {
        for (let i = 0; i < this._selections.length; i++) {
            this._selections[i] = (this._selections[i] + 1) % this._dataPoints.length;
        }
    }

    selectPreviousPixel() {
        for (let i = 0; i < this._selections.length; i++) {
            let newIndex = this._selections[i];
            if (newIndex === 0) {
                newIndex = this._dataPoints.length - 1;
            } else {
                newIndex = newIndex - 1;
            }
            this._selections[i] = newIndex;
        }
    }

    getSelectedPixels() {
        return this._selections;
    }

    getPointGroups() {
        return this._groupNames;
    }

    setPointGroups(pointGroups) {
        this._groupNames = pointGroups;
    }

    hasPointGroups() {
        return this._groupNames.length > 0;
    }

    getPointGroupsCount() {
        return this._groupNames.length;
    }

    getPointGroupIndexInTuple(tupleIndex, pixelIndex) {
        if (this._tuples[tupleIndex]) {
            return this._tuples[tupleIndex].indexOf(pixelIndex);
        }
        return -1;
    }

    getPixelIndexesInGroup(groupIndex) {
        if (groupIndex < this._groupNames.length) {
            return this._tuples.map(tuple => tuple[groupIndex]);
        }
        return [];
    }

    removePointGroupFromTuples(groupIndex) {
        if (groupIndex < this._groupNames.length) {
            this._tuples.forEach(tuple => {
                tuple.splice(groupIndex, 1);
            });
        }
    }

    addTuple(pixelIndex) {
        if (!this._tuples.some(tuple => tuple[0] === pixelIndex)) {
            // create a new array of nulls
            const tuple = Array(this._groupNames.length).fill(null);
            tuple[0] = pixelIndex;
            this._tuples.push(tuple);

            // return last index
            return this._tuples.length - 1;
        }

        return null;
    }

    addEmptyTupleAt(tupleIndex) {
        // create an "empty" tuple if it doesn't already exist
        // "empty" here means filled with nulls
        if (!this._tuples[tupleIndex]) {
            this._tuples[tupleIndex] = Array(this._groupNames.length).fill(null);
        }
    }

    addToTupleAt(tupleIndex, groupIndex, pixelIndex) {
        if (!this._tuples[tupleIndex].includes(pixelIndex)) {
            this._tuples[tupleIndex][groupIndex] = pixelIndex;
        }
    }

    removeTuple(tupleIndex) {
        if (tupleIndex < this._tuples.length) {
            this._tuples.splice(tupleIndex, 1);
        }
    }

    removeFromTupleAt(tupleIndex, pixelIndex) {
        const groupIndex = this._tuples[tupleIndex].indexOf(pixelIndex);

        if (groupIndex > -1) {
            // set group to null for the tuple
            this._tuples[tupleIndex][groupIndex] = null;
        }
    }

    getTupleIndex(pixelIndex) {
        return this._tuples.findIndex(tuple => tuple.includes(pixelIndex));
    }

    getTuple(tupleIndex) {
        return this._tuples[tupleIndex];
    }

    getTupleCount() {
        return this._tuples.length;
    }

    getAllTuples() {
        return this._tuples;
    }

    isTupleEmpty(tupleIndex) {
        return this._tuples[tupleIndex].every(groupIndex => groupIndex === null);
    }

    refreshTuplesAfterGroupAdd(count) {
        this._tuples.forEach(tuple => tuple.push(...Array(count).fill(null)));
    }

    refreshTuplesAfterPixelRemoval(removedPixelIndex) {
        for (let tupleIndex = 0; tupleIndex < this._tuples.length; tupleIndex++) {
            const tuple = this._tuples[tupleIndex];

            for (let groupIndex = 0; groupIndex < tuple.length; groupIndex++) {
                if (tuple[groupIndex] !== null) {
                    if (tuple[groupIndex] === removedPixelIndex) {
                        // set to null
                        tuple[groupIndex] = null;
                    } else if (tuple[groupIndex] > removedPixelIndex) {
                        // decrement any index greater than the removed index
                        tuple[groupIndex]--;
                    }
                }
            }
        }
    }

    getMetadata() {
        // deep clone
        return JSON.parse(JSON.stringify(this._metadata));
    }

    setMetadata(obj) {
        // deep clone
        this._metadata = JSON.parse(JSON.stringify(obj));
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

/* Parse dates and convert back and forth to Julian days */
var wpd = wpd || {};

wpd.dateConverter = (function() {
    function parse(input) {
        if (input == null) {
            return null;
        }

        if (typeof input === "string") {
            if (input.indexOf('/') < 0 && input.indexOf(':') < 0) {
                return null;
            }
        }

        return toJD(input);
    }

    function toJD(dateString) {
        dateString = dateString.toString();
        var dateParts = dateString.split(/[/ :]/),
            hasDatePart = dateString.indexOf('/') >= 0,
            year,
            month, date, hour, min, sec, timeIdxOffset, today, tempDate, rtnValue;

        if (dateParts.length <= 0 || dateParts.length > 6) {
            return null;
        }

        if (hasDatePart) {
            year = parseInt(dateParts[0], 10);
            month = parseInt(dateParts[1] === undefined ? 0 : dateParts[1], 10);
            date = parseInt(dateParts[2] === undefined ? 1 : dateParts[2], 10);
            timeIdxOffset = 3;
        } else {
            today = new Date();
            year = today.getFullYear();
            month = today.getMonth() + 1;
            date = today.getDate();
            timeIdxOffset = 0;
        }
        hour = parseInt(dateParts[timeIdxOffset] === undefined ? 0 : dateParts[timeIdxOffset], 10);
        min = parseInt(
            dateParts[timeIdxOffset + 1] === undefined ? 0 : dateParts[timeIdxOffset + 1], 10);
        sec = parseInt(
            dateParts[timeIdxOffset + 2] === undefined ? 0 : dateParts[timeIdxOffset + 2], 10);

        if (isNaN(year) || isNaN(month) || isNaN(date) || isNaN(hour) || isNaN(min) || isNaN(sec)) {
            return null;
        }

        if (month > 12 || month < 1) {
            return null;
        }

        if (date > 31 || date < 1) {
            return null;
        }

        if (hour > 23 || hour < 0) {
            return null;
        }

        if (min > 59 || min < 0) {
            return null;
        }

        if (sec > 59 || sec < 0) {
            return null;
        }

        // Temporary till I figure out julian dates:
        tempDate = new Date();
        tempDate.setUTCFullYear(year);
        tempDate.setUTCMonth(month - 1);
        tempDate.setUTCDate(date);
        tempDate.setUTCHours(hour, min, sec);
        rtnValue = parseFloat(Date.parse(tempDate));
        if (!isNaN(rtnValue)) {
            return rtnValue;
        }
        return null;
    }

    function formatDateNumber(dateNumber, formatString) {
        // round to smallest time unit
        var coeff = 1;

        if (formatString.indexOf('s') >= 0)
            coeff = 1000;
        else if (formatString.indexOf('i') >= 0)
            coeff = 1000 * 60;
        else if (formatString.indexOf('h') >= 0)
            coeff = 1000 * 60 * 60;
        else if (formatString.indexOf('d') >= 0)
            coeff = 1000 * 60 * 60 * 24;
        else if (formatString.indexOf('m') >= 0)
            coeff = 1000 * 60 * 60 * 24 * 365.2425 / 12;
        else if (formatString.indexOf('y') >= 0)
            coeff = 1000 * 60 * 60 * 24 * 365.2425;

        return formatDate(new Date(Math.round(new Date(dateNumber).getTime() / coeff) * coeff),
            formatString);
    }

    function formatDate(dateObject, formatString) {

        var longMonths = [],
            shortMonths = [],
            tmpDate = new Date('1/1/2021');

        for (var i = 0; i < 12; i++) {
            tmpDate.setUTCMonth(i);
            longMonths.push(tmpDate.toLocaleString(undefined, {
                month: "long"
            }));
            shortMonths.push(tmpDate.toLocaleString(undefined, {
                month: "short"
            }));
        }

        var outputString = formatString;

        outputString = outputString.replace("YYYY", "yyyy");
        outputString = outputString.replace("YY", "yy");
        outputString = outputString.replace("MMMM", "mmmm");
        outputString = outputString.replace("MMM", "mmm");
        outputString = outputString.replace("MM", "mm");
        outputString = outputString.replace("DD", "dd");
        outputString = outputString.replace("HH", "hh");
        outputString = outputString.replace("II", "ii");
        outputString = outputString.replace("SS", "ss");

        outputString = outputString.replace("yyyy", dateObject.getUTCFullYear());

        var twoDigitYear = dateObject.getUTCFullYear() % 100;
        twoDigitYear = twoDigitYear < 10 ? '0' + twoDigitYear : twoDigitYear;

        outputString = outputString.replace("yy", twoDigitYear);

        outputString = outputString.replace("mmmm", longMonths[dateObject.getUTCMonth()]);
        outputString = outputString.replace("mmm", shortMonths[dateObject.getUTCMonth()]);
        outputString = outputString.replace("mm", ("0" + (dateObject.getUTCMonth() + 1)).slice(-2));
        outputString = outputString.replace("dd", ("0" + dateObject.getUTCDate()).slice(-2));

        outputString = outputString.replace("hh", ("0" + dateObject.getUTCHours()).slice(-2));
        outputString = outputString.replace("ii", ("0" + dateObject.getUTCMinutes()).slice(-2));
        outputString = outputString.replace("ss", ("0" + dateObject.getUTCSeconds()).slice(-2));

        return outputString;
    }

    function getFormatString(dateString) {
        var dateParts = dateString.split(/[/ :]/),
            hasDatePart = dateString.indexOf('/') >= 0,
            formatString = 'yyyy/mm/dd hh:ii:ss';

        if (dateParts.length >= 1) {
            formatString = hasDatePart ? 'yyyy' : 'hh';
        }

        if (dateParts.length >= 2) {
            formatString += hasDatePart ? '/mm' : ':ii';
        }

        if (dateParts.length >= 3) {
            formatString += hasDatePart ? '/dd' : ':ss';
        }

        if (dateParts.length >= 4) {
            formatString += ' hh';
        }

        if (dateParts.length >= 5) {
            formatString += ':ii';
        }

        if (dateParts.length === 6) {
            formatString += ':ss';
        }

        return formatString;
    }

    return {
        parse: parse,
        getFormatString: getFormatString,
        formatDateNumber: formatDateNumber
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.gridDetectionCore = (function() {
    var hasHorizontal, hasVertical, xFrac = 0.1,
        yFrac = 0.1;

    function run(autoDetector) {
        var gridData = new Set(),
            xi, yi, xmin = autoDetector.gridMask.xmin,
            xmax = autoDetector.gridMask.xmax,
            ymin = autoDetector.gridMask.ymin,
            ymax = autoDetector.gridMask.ymax,
            dw = autoDetector.imageWidth,
            dh = autoDetector.imageHeight,
            linePixCount;

        if (hasVertical) {

            for (xi = xmin; xi <= xmax; xi++) {
                linePixCount = 0;
                for (yi = ymin; yi < ymax; yi++) {
                    if (autoDetector.binaryData.has(yi * dw + xi)) {
                        linePixCount++;
                    }
                }
                if (linePixCount > yFrac * (ymax - ymin)) {
                    for (yi = ymin; yi < ymax; yi++) {
                        gridData.add(yi * dw + xi);
                    }
                }
            }
        }

        if (hasHorizontal) {

            for (yi = ymin; yi <= ymax; yi++) {
                linePixCount = 0;
                for (xi = xmin; xi <= xmax; xi++) {
                    if (autoDetector.binaryData.has(yi * dw + xi)) {
                        linePixCount++;
                    }
                }
                if (linePixCount > xFrac * (xmax - xmin)) {
                    for (xi = xmin; xi <= xmax; xi++) {
                        gridData.add(yi * dw + xi);
                    }
                }
            }
        }

        return gridData;
    }

    function setHorizontalParameters(has_horizontal, y_perc) {
        hasHorizontal = has_horizontal;
        yFrac = Math.abs(parseFloat(y_perc) / 100.0);
    }

    function setVerticalParameters(has_vertical, x_perc) {
        hasVertical = has_vertical;
        xFrac = Math.abs(parseFloat(x_perc) / 100.0);
    }

    return {
        run: run,
        setHorizontalParameters: setHorizontalParameters,
        setVerticalParameters: setVerticalParameters
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

/* Parse user provided expressions, dates etc. */
var wpd = wpd || {};

wpd.InputParser = class {
    constructor() {
        // public:
        this.isValid = false;
        this.isDate = false;
        this.formatting = null;
        this.isArray = false;
    }

    parse(input) {
        this.isValid = false;
        this.isDate = false;
        this.formatting = null;

        if (input == null) {
            return null;
        }

        if (typeof input === "string") {
            input = input.trim();

            if (input.indexOf('^') >= 0) {
                return null;
            }
        }

        let parsedDate = wpd.dateConverter.parse(input);
        if (parsedDate != null) {
            this.isValid = true;
            this.isDate = true;
            this.formatting = wpd.dateConverter.getFormatString(input);
            return parsedDate;
        }

        let parsedArray = this._parseArray(input);
        if (parsedArray != null) {
            this.isValid = true;
            this.isArray = true;
            return parsedArray;
        }

        let parsedFloat = parseFloat(input);
        if (!isNaN(parsedFloat)) {
            this.isValid = true;
            return parsedFloat;
        }

        return null;
    }

    _parseArray(input) {
        // e.g. convert "[1.2, 3.4, 100]" to an array [1.2, 3.4, 100]
        // TODO: support comma decimal separators somehow...
        let valArray = input.replace("[", "").replace("]", "").split(",").map(v => parseFloat(v)).filter(v => !isNaN(v));
        if (valArray.length == 0) {
            return null;
        }
        return valArray;
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Calculate inverse tan with range between 0, 2*pi.
 */
var wpd = wpd || {};

wpd.taninverse = function(y, x) {
    var inv_ans;
    if (y > 0) // I & II
        inv_ans = Math.atan2(y, x);
    else if (y <= 0) // III & IV
        inv_ans = Math.atan2(y, x) + 2 * Math.PI;

    if (inv_ans >= 2 * Math.PI)
        inv_ans = 0.0;
    return inv_ans;
};

wpd.sqDist2d = function(x1, y1, x2, y2) {
    return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
};

wpd.sqDist3d = function(
    x1, y1, z1, x2, y2,
    z2) {
    return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2) + (z1 - z2) * (z1 - z2);
};

wpd.dist2d = function(x1, y1, x2, y2) {
    return Math.sqrt(wpd.sqDist2d(x1, y1, x2, y2));
};

wpd.dist3d = function(x1, y1, z1, x2, y2,
    z2) {
    return Math.sqrt(wpd.sqDist3d(x1, y1, z1, x2, y2, z2));
};

wpd.mat = (function() {
    function det2x2(m) {
        return m[0] * m[3] - m[1] * m[2];
    }

    function inv2x2(m) {
        var det = det2x2(m);
        return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
    }

    function mult2x2(m1, m2) {
        return [
            m1[0] * m2[0] + m1[1] * m2[2], m1[0] * m2[1] + m1[1] * m2[3],
            m1[2] * m2[0] + m1[3] * m2[2], m1[2] * m2[1] + m1[3] * m2[3]
        ];
    }

    function mult2x2Vec(m, v) {
        return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
    }

    function multVec2x2(v, m) {
        return [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];
    }

    return {
        det2x2: det2x2,
        inv2x2: inv2x2,
        mult2x2: mult2x2,
        mult2x2Vec: mult2x2Vec,
        multVec2x2: multVec2x2
    };
})();

wpd.cspline =
    function(x, y) {
        var len = x.length,
            cs = {
                x: x,
                y: y,
                len: len,
                d: []
            },
            l = [],
            b = [],
            i;

        /* TODO: when len = 1, return the same value. For len = 2, do a linear interpolation */
        if (len < 3) {
            return null;
        }

        b[0] = 2.0;
        l[0] = 3.0 * (y[1] - y[0]);
        for (i = 1; i < len - 1; ++i) {
            b[i] = 4.0 - 1.0 / b[i - 1];
            l[i] = 3.0 * (y[i + 1] - y[i - 1]) - l[i - 1] / b[i - 1];
        }

        b[len - 1] = 2.0 - 1.0 / b[len - 2];
        l[len - 1] = 3.0 * (y[len - 1] - y[len - 2]) - l[len - 2] / b[len - 1];

        i = len - 1;
        cs.d[i] = l[i] / b[i];
        while (i > 0) {
            --i;
            cs.d[i] = (l[i] - cs.d[i + 1]) / b[i];
        }

        return cs;
    };

wpd.cspline_interp =
    function(cs, x) {
        var i = 0,
            t, a, b, c, d;
        if (x >= cs.x[cs.len - 1] || x < cs.x[0]) {
            return null;
        }

        /* linear search to find the index */
        while (x > cs.x[i]) {
            i++;
        }

        i = (i > 0) ? i - 1 : 0;
        t = (x - cs.x[i]) / (cs.x[i + 1] - cs.x[i]);
        a = cs.y[i];
        b = cs.d[i];
        c = 3.0 * (cs.y[i + 1] - cs.y[i]) - 2.0 * cs.d[i] - cs.d[i + 1];
        d = 2.0 * (cs.y[i] - cs.y[i + 1]) + cs.d[i] + cs.d[i + 1];
        return a + b * t + c * t * t + d * t * t * t;
    };/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// Plot information

wpd.PlotData = class {
    constructor() {
        this._topColors = null;
        this._axesColl = [];
        this._datasetColl = [];
        this._measurementColl = [];
        this._objectAxesMap = new Map();
        this._datasetAutoDetectionDataMap = new Map();
        this._gridDetectionData = null;
    }

    reset() {
        this._axesColl = [];
        this._datasetColl = [];
        this._measurementColl = [];
        this._objectAxesMap = new Map();
        this._datasetAutoDetectionDataMap = new Map();
        this._gridDetectionData = null;
    }

    setTopColors(topColors) {
        this._topColors = topColors;
    }

    getTopColors(topColors) {
        return this._topColors;
    }

    addAxes(ax) {
        this._axesColl.push(ax);
    }

    getAxesColl() {
        return this._axesColl;
    }

    getAxesNames() {
        let names = [];
        this._axesColl.forEach((ax) => {
            names.push(ax.name);
        });
        return names;
    }

    deleteAxes(ax) {
        let axIdx = this._axesColl.indexOf(ax);
        if (axIdx >= 0) {
            this._axesColl.splice(axIdx, 1);

            // take care of dependents
            this._objectAxesMap.forEach((val, key, map) => {
                if (val === ax) {
                    map.set(key, null);
                }
            });
        }
    }

    getAxesCount() {
        return this._axesColl.length;
    }

    addDataset(ds) {
        this._datasetColl.push(ds);

        // by default bind ds to last axes
        const axCount = this._axesColl.length;
        if (axCount > 0) {
            let axes = this._axesColl[axCount - 1];
            this.setAxesForDataset(ds, axes);
        }
    }

    getDatasets() {
        return this._datasetColl;
    }

    getDatasetNames() {
        let names = [];
        this._datasetColl.forEach((ds) => {
            names.push(ds.name);
        });
        return names;
    }

    getDatasetCount() {
        return this._datasetColl.length;
    }

    addMeasurement(ms, skipAutoAttach) {
        this._measurementColl.push(ms);

        // if this is a distance measurement, then attach to first existing image or map axes:
        if (!skipAutoAttach && ms instanceof wpd.DistanceMeasurement && this._axesColl.length > 0) {
            for (let aIdx = 0; aIdx < this._axesColl.length; aIdx++) {
                if (this._axesColl[aIdx] instanceof wpd.MapAxes || this._axesColl[aIdx] instanceof wpd.ImageAxes) {
                    this.setAxesForMeasurement(ms, this._axesColl[aIdx]);
                    break;
                }
            }
        }
    }

    getMeasurementColl() {
        return this._measurementColl;
    }

    getMeasurementsByType(mtype) {
        let mcoll = [];
        this._measurementColl.forEach(m => {
            if (m instanceof mtype) {
                mcoll.push(m);
            }
        });
        return mcoll;
    }

    deleteMeasurement(ms) {
        var msIdx = this._measurementColl.indexOf(ms);
        if (msIdx >= 0) {
            this._measurementColl.splice(msIdx, 1);
            this._objectAxesMap.delete(ms);
        }
    }

    setAxesForDataset(ds, ax) {
        this._objectAxesMap.set(ds, ax);
    }

    setAxesForMeasurement(ms, ax) {
        this._objectAxesMap.set(ms, ax);
    }

    setAutoDetectionDataForDataset(ds, autoDetectionData) {
        this._datasetAutoDetectionDataMap.set(ds, autoDetectionData);
    }

    getAxesForDataset(ds) {
        return this._objectAxesMap.get(ds);
    }

    getAxesForMeasurement(ms) {
        return this._objectAxesMap.get(ms);
    }

    getAutoDetectionDataForDataset(ds) {
        let ad = this._datasetAutoDetectionDataMap.get(ds);
        if (ad == null) { // create one if no autodetection data is present!
            ad = new wpd.AutoDetectionData();
            this.setAutoDetectionDataForDataset(ds, ad);
        }
        return ad;
    }

    getGridDetectionData() {
        if (this._gridDetectionData == null) {
            this._gridDetectionData = new wpd.GridDetectionData();
        }
        return this._gridDetectionData;
    }

    deleteDataset(ds) {
        var dsIdx = this._datasetColl.indexOf(ds);
        if (dsIdx >= 0) {
            this._datasetColl.splice(dsIdx, 1);
            this._objectAxesMap.delete(ds);
            this._datasetAutoDetectionDataMap.delete(ds);
        }
    }

    _deserializePreVersion4(data) {
        // read axes info
        if (data.axesType == null) {
            return true;
        }
        if (data.axesType !== "ImageAxes" &&
            (data.calibration == null || data.axesParameters == null)) {
            return false;
        }

        // get calibration points
        let calibration = null;
        if (data.axesType !== "ImageAxes") {
            if (data.axesType === "TernaryAxes") {
                calibration = new wpd.Calibration(3);
            } else {
                calibration = new wpd.Calibration(2);
            }
            for (let calIdx = 0; calIdx < data.calibration.length; calIdx++) {
                calibration.addPoint(data.calibration[calIdx].px, data.calibration[calIdx].py,
                    data.calibration[calIdx].dx, data.calibration[calIdx].dy,
                    data.calibration[calIdx].dz);
            }
        }

        let axes = null;
        if (data.axesType === "XYAxes") {
            axes = new wpd.XYAxes();
            calibration.labels = ['X1', 'X2', 'Y1', 'Y2'];
            calibration.labelPositions = ['N', 'N', 'E', 'E'];
            calibration.maxPointCount = 4;
            axes.calibrate(calibration, data.axesParameters.isLogX, data.axesParameters.isLogY);
        } else if (data.axesType === "BarAxes") {
            axes = new wpd.BarAxes();
            calibration.labels = ['P1', 'P2'];
            calibration.labelPositions = ['S', 'S'];
            calibration.maxPointCount = 2;
            axes.calibrate(calibration, data.axesParameters.isLog);
        } else if (data.axesType === "PolarAxes") {
            axes = new wpd.PolarAxes();
            calibration.labels = ['Origin', 'P1', 'P2'];
            calibration.labelPositions = ['E', 'S', 'S'];
            calibration.maxPointCount = 3;
            axes.calibrate(calibration, data.axesParameters.isDegrees,
                data.axesParameters.isClockwise);
        } else if (data.axesType === "TernaryAxes") {
            axes = new wpd.TernaryAxes();
            calibration.labels = ['A', 'B', 'C'];
            calibration.labelPositions = ['S', 'S', 'E'];
            calibration.maxPointCount = 3;
            axes.calibrate(calibration, data.axesParameters.isRange100,
                data.axesParameters.isNormalOrientation);
        } else if (data.axesType === "MapAxes") {
            axes = new wpd.MapAxes();
            calibration.labels = ['P1', 'P2'];
            calibration.labelPositions = ['S', 'S'];
            calibration.maxPointCount = 2;
            axes.calibrate(calibration, data.axesParameters.scaleLength,
                data.axesParameters.unitString);
        } else if (data.axesType === "ImageAxes") {
            axes = new wpd.ImageAxes();
        }

        if (axes != null) {
            this._axesColl.push(axes);
        }

        // datasets
        if (data.dataSeries != null) {
            for (let dsIdx = 0; dsIdx < data.dataSeries.length; dsIdx++) {
                const dsData = data.dataSeries[dsIdx];
                let ds = new wpd.Dataset();
                ds.name = dsData.name;
                if (dsData.metadataKeys != null && dsData.metadataKeys.length > 0) {
                    ds.setMetadataKeys(dsData.metadataKeys.map(k => k.toLowerCase()));
                }
                for (let pxIdx = 0; pxIdx < dsData.data.length; pxIdx++) {
                    // only label key existed in the past
                    if (dsData.metadataKeys.length > 0) {
                        const metadataKey = dsData.metadataKeys[0].toLowerCase();
                        const metadataValue = dsData.data[pxIdx].metadata[0];
                        ds.addPixel(dsData.data[pxIdx].x, dsData.data[pxIdx].y, {
                            [metadataKey]: metadataValue
                        });
                    } else {
                        ds.addPixel(dsData.data[pxIdx].x, dsData.data[pxIdx].y);
                    }
                }
                this.addDataset(ds);
                this.setAxesForDataset(ds, axes);
            }
        }

        // measurements

        // distances
        if (data.distanceMeasurementData != null) {
            let dist = new wpd.DistanceMeasurement();
            for (let cIdx = 0; cIdx < data.distanceMeasurementData.length; cIdx++) {
                dist.addConnection(data.distanceMeasurementData[cIdx]);
            }
            this.addMeasurement(dist);
            if (axes instanceof wpd.MapAxes) {
                this.setAxesForMeasurement(dist, axes);
            }
        }

        // angles
        if (data.angleMeasurementData != null) {
            let ang = new wpd.AngleMeasurement();
            for (let cIdx = 0; cIdx < data.angleMeasurementData.length; cIdx++) {
                ang.addConnection(data.angleMeasurementData[cIdx]);
            }
            this.addMeasurement(ang);
        }

        return true;
    }

    _deserializeVersion4(data) {
        // collect page data if it exists
        let documentMetadata = {};

        const collectMetadata = (group, type, key, object) => {
            if (!documentMetadata[group])
                documentMetadata[group] = {};
            if (!documentMetadata[group][type])
                documentMetadata[group][type] = {};
            if (!documentMetadata[group][type][key])
                documentMetadata[group][type][key] = [];
            documentMetadata[group][type][key].push(object);
        };

        // axes data
        if (data.axesColl != null) {
            for (let axIdx = 0; axIdx < data.axesColl.length; axIdx++) {
                const axData = data.axesColl[axIdx];

                // get calibration
                let calibration = null;
                if (axData.type !== "ImageAxes") {
                    if (axData.type === "TernaryAxes") {
                        calibration = new wpd.Calibration(3);
                    } else {
                        calibration = new wpd.Calibration(2);
                    }
                    for (let calIdx = 0; calIdx < axData.calibrationPoints.length; calIdx++) {
                        calibration.addPoint(axData.calibrationPoints[calIdx].px,
                            axData.calibrationPoints[calIdx].py,
                            axData.calibrationPoints[calIdx].dx,
                            axData.calibrationPoints[calIdx].dy,
                            axData.calibrationPoints[calIdx].dz);
                    }
                }

                // create axes
                let axes = null;
                if (axData.type === "XYAxes") {
                    axes = new wpd.XYAxes();
                    calibration.labels = ['X1', 'X2', 'Y1', 'Y2'];
                    calibration.labelPositions = ['N', 'N', 'E', 'E'];
                    calibration.maxPointCount = 4;
                    axes.calibrate(calibration, axData.isLogX, axData.isLogY, axData.noRotation);
                } else if (axData.type === "BarAxes") {
                    axes = new wpd.BarAxes();
                    calibration.labels = ['P1', 'P2'];
                    calibration.labelPositions = ['S', 'S'];
                    calibration.maxPointCount = 2;
                    axes.calibrate(calibration, axData.isLog,
                        axData.isRotated == null ? false : axData.isRotated);
                } else if (axData.type === "PolarAxes") {
                    axes = new wpd.PolarAxes();
                    calibration.labels = ['Origin', 'P1', 'P2'];
                    calibration.labelPositions = ['E', 'S', 'S'];
                    calibration.maxPointCount = 3;
                    axes.calibrate(calibration, axData.isDegrees, axData.isClockwise, axData.isLog);
                } else if (axData.type === "TernaryAxes") {
                    axes = new wpd.TernaryAxes();
                    calibration.labels = ['A', 'B', 'C'];
                    calibration.labelPositions = ['S', 'S', 'E'];
                    calibration.maxPointCount = 3;
                    axes.calibrate(calibration, axData.isRange100, axData.isNormalOrientation);
                } else if (axData.type === "MapAxes") {
                    axes = new wpd.MapAxes();
                    calibration.labels = ['P1', 'P2'];
                    calibration.labelPositions = ['S', 'S'];
                    calibration.maxPointCount = 2;
                    axes.calibrate(calibration, axData.scaleLength, axData.unitString);
                } else if (axData.type === "ImageAxes") {
                    axes = new wpd.ImageAxes();
                }

                if (axes != null) {
                    axes.name = axData.name;

                    if (axes.metadata !== undefined) {
                        axes.metadata = axData.metadata;
                    }

                    this._axesColl.push(axes);

                    // collect document metadata
                    if (axData.file !== undefined) {
                        collectMetadata('file', 'axes', axData.file, axes);
                    }
                    if (axData.page !== undefined) {
                        collectMetadata('page', 'axes', axData.page, axes);
                    }
                }
            }
        }

        // datasets
        if (data.datasetColl != null) {
            for (let dsIdx = 0; dsIdx < data.datasetColl.length; dsIdx++) {
                const dsData = data.datasetColl[dsIdx];
                let ds = new wpd.Dataset();
                ds.name = dsData.name;
                if (dsData.colorRGB != null) {
                    ds.colorRGB = new wpd.Color(dsData.colorRGB[0], dsData.colorRGB[1], dsData.colorRGB[2]);
                }
                // dataset metadata
                if (dsData.metadata !== undefined) {
                    ds.setMetadata(dsData.metadata);
                }
                // data point groups
                if (dsData.groupNames !== undefined) {
                    ds.setPointGroups(dsData.groupNames);
                }
                // data points metadata keys
                if (dsData.metadataKeys != null) {
                    ds.setMetadataKeys(dsData.metadataKeys);
                }

                // data points
                for (let pxIdx = 0; pxIdx < dsData.data.length; pxIdx++) {
                    // for backwards compatibility; metadata was updated from array
                    // to object
                    let metadata = dsData.data[pxIdx].metadata;
                    if (dsData.data[pxIdx].metadata != null) {
                        if (Array.isArray(metadata)) {
                            // transform metadata array into object
                            metadata = metadata.reduce((obj, val, idx) => {
                                return {
                                    ...obj,
                                    [dsData.metadataKeys[idx]]: val
                                };
                            }, {});
                        }
                    }
                    // set point group data, if present
                    if (
                        ds.hasPointGroups() &&
                        dsData.data[pxIdx].tuple !== undefined &&
                        dsData.data[pxIdx].group !== undefined
                    ) {
                        // addEmptyTupleAt checks if tuple exists
                        ds.addEmptyTupleAt(dsData.data[pxIdx].tuple);
                        ds.addToTupleAt(dsData.data[pxIdx].tuple, dsData.data[pxIdx].group, pxIdx);
                    }
                    ds.addPixel(dsData.data[pxIdx].x, dsData.data[pxIdx].y, metadata);
                }
                this._datasetColl.push(ds);

                // collect document metadata
                if (dsData.file !== undefined) {
                    collectMetadata('file', 'datasets', dsData.file, ds);
                }
                if (dsData.page !== undefined) {
                    collectMetadata('page', 'datasets', dsData.page, ds);
                }

                // set axes for this dataset
                const axIdx = this.getAxesNames().indexOf(dsData.axesName);
                if (axIdx >= 0) {
                    this.setAxesForDataset(ds, this._axesColl[axIdx]);
                }

                // autodetector
                if (dsData.autoDetectionData != null) {
                    let autoDetectionData = new wpd.AutoDetectionData();
                    autoDetectionData.deserialize(dsData.autoDetectionData);
                    this.setAutoDetectionDataForDataset(ds, autoDetectionData);
                }
            }
        }

        // measurements
        if (data.measurementColl != null) {
            for (let msIdx = 0; msIdx < data.measurementColl.length; msIdx++) {
                const msData = data.measurementColl[msIdx];
                let ms = null;
                if (msData.type === "Distance") {
                    ms = new wpd.DistanceMeasurement();
                    this._measurementColl.push(ms);
                    // set axes
                    const axIdx = this.getAxesNames().indexOf(msData.axesName);
                    if (axIdx >= 0) {
                        this.setAxesForMeasurement(ms, this._axesColl[axIdx]);
                    }
                } else if (msData.type === "Angle") {
                    ms = new wpd.AngleMeasurement();
                    this._measurementColl.push(ms);
                } else if (msData.type === "Area") {
                    ms = new wpd.AreaMeasurement();
                    this._measurementColl.push(ms);
                    // set axes
                    const axIdx = this.getAxesNames().indexOf(msData.axesName);
                    if (axIdx >= 0) {
                        this.setAxesForMeasurement(ms, this._axesColl[axIdx]);
                    }
                }
                if (ms != null) {
                    // add connections
                    for (let cIdx = 0; cIdx < msData.data.length; cIdx++) {
                        ms.addConnection(msData.data[cIdx]);
                    }

                    // collect document metadata
                    if (msData.file !== undefined) {
                        collectMetadata('file', 'measurements', msData.file, ms);
                    }
                    if (msData.page !== undefined) {
                        collectMetadata('page', 'measurements', msData.page, ms);
                    }
                }
            }
        }

        // misc
        if (data.misc != null) {
            documentMetadata.misc = data.misc;
        }

        return documentMetadata;
    }

    deserialize(data) {
        this.reset();
        try {
            if (data.wpd != null && data.wpd.version[0] === 3) {
                return this._deserializePreVersion4(data.wpd);
            }
            if (data.version != null && data.version[0] === 4) {
                return this._deserializeVersion4(data);
            }
            return true;
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    serialize(documentMetadata) {
        let data = {};
        data.version = [4, 2];
        data.axesColl = [];
        data.datasetColl = [];
        data.measurementColl = [];

        // axes data
        for (let axIdx = 0; axIdx < this._axesColl.length; axIdx++) {
            const axes = this._axesColl[axIdx];
            let axData = {};
            axData.name = axes.name;

            // file and page metadata
            if (documentMetadata) {
                if (documentMetadata.file && documentMetadata.file.axes[axes.name] !== undefined) {
                    axData.file = documentMetadata.file.axes[axes.name];
                }
                if (documentMetadata.page && documentMetadata.page.axes[axes.name] !== undefined) {
                    axData.page = documentMetadata.page.axes[axes.name];
                }
            }

            // axes data
            if (axes instanceof wpd.XYAxes) {
                axData.type = "XYAxes";
                axData.isLogX = axes.isLogX();
                axData.isLogY = axes.isLogY();
                axData.noRotation = axes.noRotation();
            } else if (axes instanceof wpd.BarAxes) {
                axData.type = "BarAxes";
                axData.isLog = axes.isLog();
                axData.isRotated = axes.isRotated();
            } else if (axes instanceof wpd.PolarAxes) {
                axData.type = "PolarAxes";
                axData.isDegrees = axes.isThetaDegrees();
                axData.isClockwise = axes.isThetaClockwise();
                axData.isLog = axes.isRadialLog();
            } else if (axes instanceof wpd.TernaryAxes) {
                axData.type = "TernaryAxes";
                axData.isRange100 = axes.isRange100();
                axData.isNormalOrientation = axes.isNormalOrientation;
            } else if (axes instanceof wpd.MapAxes) {
                axData.type = "MapAxes";
                axData.scaleLength = axes.getScaleLength();
                axData.unitString = axes.getUnits();
            } else if (axes instanceof wpd.ImageAxes) {
                axData.type = "ImageAxes";
            }

            // include axes metadata, if present
            if (Object.keys(axes.getMetadata()).length > 0) {
                axData.metadata = axes.getMetadata();
            }

            // calibration points
            if (!(axes instanceof wpd.ImageAxes)) {
                axData.calibrationPoints = [];
                for (let calIdx = 0; calIdx < axes.calibration.getCount(); calIdx++) {
                    axData.calibrationPoints.push(axes.calibration.getPoint(calIdx));
                }
            }

            data.axesColl.push(axData);
        }

        // datasets
        for (let dsIdx = 0; dsIdx < this._datasetColl.length; dsIdx++) {
            const ds = this._datasetColl[dsIdx];
            const axes = this.getAxesForDataset(ds);
            const autoDetectionData = this.getAutoDetectionDataForDataset(ds);

            // dataset information
            let dsData = {};
            dsData.name = ds.name;
            dsData.axesName = axes != null ? axes.name : "";
            dsData.colorRGB = ds.colorRGB.serialize();
            dsData.metadataKeys = ds.getMetadataKeys(); // point metadata keys
            // include file and page information, if present
            if (documentMetadata) {
                if (documentMetadata.file && documentMetadata.file.datasets[ds.name] !== undefined) {
                    dsData.file = documentMetadata.file.datasets[ds.name];
                }
                if (documentMetadata.page && documentMetadata.page.datasets[ds.name] !== undefined) {
                    dsData.page = documentMetadata.page.datasets[ds.name];
                }
            }
            // include point group names, if present
            if (ds.hasPointGroups()) {
                dsData.groupNames = ds.getPointGroups();
            }
            // include dataset metadata, if present
            if (Object.keys(ds.getMetadata()).length > 0) {
                // this is metadata on the dataset itself, not to be confused with metadataKeys which denote metadata keys on
                // each data point within the dataset
                dsData.metadata = ds.getMetadata();
            }

            // data points
            dsData.data = [];
            for (let pxIdx = 0; pxIdx < ds.getCount(); pxIdx++) {
                let px = ds.getPixel(pxIdx);

                // include point group data, if present
                if (ds.hasPointGroups()) {
                    const tupleIdx = ds.getTupleIndex(pxIdx)
                    const groupIdx = ds.getPointGroupIndexInTuple(tupleIdx, pxIdx);
                    if (tupleIdx > -1 && groupIdx > -1) {
                        px.tuple = tupleIdx;
                        px.group = groupIdx;
                    }
                }

                dsData.data[pxIdx] = px;
                if (axes != null) {
                    dsData.data[pxIdx].value = axes.pixelToData(px.x, px.y);
                }
            }
            dsData.autoDetectionData =
                autoDetectionData != null ? autoDetectionData.serialize() : null;
            data.datasetColl.push(dsData);
        }

        // measurements
        for (let msIdx = 0; msIdx < this._measurementColl.length; msIdx++) {
            const ms = this._measurementColl[msIdx];
            const axes = this.getAxesForMeasurement(ms);
            let msData = {};
            if (ms instanceof wpd.DistanceMeasurement) {
                msData.type = "Distance";
                msData.name = "Distance";
                msData.axesName = axes != null ? axes.name : "";
            } else if (ms instanceof wpd.AngleMeasurement) {
                msData.type = "Angle";
                msData.name = "Angle";
            } else if (ms instanceof wpd.AreaMeasurement) {
                msData.type = "Area";
                msData.name = "Area";
                msData.axesName = axes != null ? axes.name : "";
            }
            if (documentMetadata) {
                if (documentMetadata.file && documentMetadata.file.measurements[msIdx] !== undefined) {
                    msData.file = documentMetadata.file.measurements[msIdx];
                }
                if (documentMetadata.page && documentMetadata.page.measurements[msIdx] !== undefined) {
                    msData.page = documentMetadata.page.measurements[msIdx];
                }
            }
            msData.data = [];
            for (let cIdx = 0; cIdx < ms.connectionCount(); cIdx++) {
                msData.data.push(ms.getConnectionAt(cIdx));
            }
            data.measurementColl.push(msData);
        }

        if (documentMetadata && documentMetadata.misc) {
            data.misc = documentMetadata.misc;
        }

        return data;
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// Run-length encoder/decoder (Mainly used for masks)
wpd.rle = {};

// wpd.rle.encode - Encode a sorted array of integers
wpd.rle.encode = function(sortedArray) {
    // return an array as [[pos, count], [pos, count], ... ]
    let ret = [];
    let prevVal = null;
    let item = [0, 0];
    for (let val of sortedArray) {
        if (prevVal == null) { // first item
            item = [val, 1];
        } else if (val == prevVal + 1) { // continued item
            item[1]++;
        } else { // item ended
            ret.push(item);
            item = [val, 1];
        }
        prevVal = val;
    }
    // add last item
    if (item[1] != 0) {
        ret.push(item);
    }

    return ret;
};

// wpd.rle.decode - Decode RLE array with data as [[pos, count], [pos, count], ... ] etc.
wpd.rle.decode = function(rleArray) {
    let ret = [];
    for (let item of rleArray) {
        let val = item[0];
        let count = item[1];
        for (let i = 0; i < count; ++i) {
            ret.push(val + i);
        }
    }
    return ret;
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.AveragingWindowCore = class {

    constructor(binaryData, imageHeight, imageWidth, dx, dy, dataSeries) {
        this._binaryData = binaryData;
        this._imageHeight = imageHeight;
        this._imageWidth = imageWidth;
        this._dx = dx;
        this._dy = dy;
        this._dataSeries = dataSeries;
    }

    run() {
        var xPoints = [],
            xPointsPicked = 0,
            pointsPicked = 0,
            dw = this._imageWidth,
            dh = this._imageHeight,
            blobAvg = [],
            coli, rowi, firstbloby, bi, blobs, blbi, xi, yi,
            pi, inRange, xxi, oldX, oldY, avgX, avgY, newX, newY, matches, xStep = this._dx,
            yStep = this._dy;

        this._dataSeries.clearAll();

        for (coli = 0; coli < dw; coli++) {

            blobs = -1;
            firstbloby = -2.0 * yStep;
            bi = 0;

            // Scan vertically for blobs:

            for (rowi = 0; rowi < dh; rowi++) {
                if (this._binaryData.has(rowi * dw + coli)) {
                    if (rowi > firstbloby + yStep) {
                        blobs = blobs + 1;
                        bi = 1;
                        blobAvg[blobs] = rowi;
                        firstbloby = rowi;
                    } else {
                        bi = bi + 1;
                        blobAvg[blobs] =
                            parseFloat((blobAvg[blobs] * (bi - 1.0) + rowi) / parseFloat(bi));
                    }
                }
            }

            if (blobs >= 0) {
                xi = coli + 0.5;
                for (blbi = 0; blbi <= blobs; blbi++) {
                    yi = blobAvg[blbi] + 0.5; // add 0.5 to shift to the middle of the pixels
                    // instead of the starting edge.

                    xPoints[xPointsPicked] = [];
                    xPoints[xPointsPicked][0] = parseFloat(xi);
                    xPoints[xPointsPicked][1] = parseFloat(yi);
                    xPoints[xPointsPicked][2] =
                        true; // true if not filtered, false if processed already
                    xPointsPicked = xPointsPicked + 1;
                }
            }
        }

        if (xPointsPicked === 0) {
            return;
        }

        for (pi = 0; pi < xPointsPicked; pi++) {
            if (xPoints[pi][2] === true) { // if still available
                inRange = true;
                xxi = pi + 1;

                oldX = xPoints[pi][0];
                oldY = xPoints[pi][1];

                avgX = oldX;
                avgY = oldY;

                matches = 1;

                while ((inRange === true) && (xxi < xPointsPicked)) {
                    newX = xPoints[xxi][0];
                    newY = xPoints[xxi][1];

                    if ((Math.abs(newX - oldX) <= xStep) && (Math.abs(newY - oldY) <= yStep) &&
                        (xPoints[xxi][2] === true)) {
                        avgX = (avgX * matches + newX) / (matches + 1.0);
                        avgY = (avgY * matches + newY) / (matches + 1.0);
                        matches = matches + 1;
                        xPoints[xxi][2] = false;
                    }

                    if (newX > oldX + 2 * xStep) {
                        inRange = false;
                    }

                    xxi = xxi + 1;
                }

                xPoints[pi][2] = false;

                pointsPicked = pointsPicked + 1;
                this._dataSeries.addPixel(parseFloat(avgX), parseFloat(avgY));
            }
        }
        xPoints = [];
        return this._dataSeries;
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.AveragingWindowAlgo = class {

    constructor() {
        this._xStep = 10;
        this._yStep = 10;
        this._wasRun = false;
    }

    getParamList(axes) {
        return {
            xStep: ['ΔX', 'Px', this._xStep],
            yStep: ['ΔY', 'Px', this._yStep]
        };
    }

    setParams(params) {
        this._xStep = parseFloat(params.xStep);
        this._yStep = parseFloat(params.yStep);
    }

    getParams() {
        return {
            xStep: this._xStep,
            yStep: this._yStep
        };
    }

    serialize() {
        return this._wasRun ? {
                algoType: "AveragingWindowAlgo",
                xStep: this._xStep,
                yStep: this._yStep
            } :
            null;
    }

    deserialize(obj) {
        this._xStep = obj.xStep;
        this._yStep = obj.yStep;
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        let algoCore = new wpd.AveragingWindowCore(
            autoDetector.binaryData, autoDetector.imageHeight, autoDetector.imageWidth, this._xStep,
            this._yStep, dataSeries);
        algoCore.run();
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/
var wpd = wpd || {};

wpd.AveragingWindowWithStepSizeAlgo = class {

    constructor() {
        this._xmin = 0;
        this._xmax = 0;
        this._delx = 0.1;
        this._lineWidth = 30;
        this._ymin = 0;
        this._ymax = 0;
        this._wasRun = false;
    }

    getParamList(axes) {
        if (!this._wasRun) {
            if (axes != null && axes instanceof wpd.XYAxes) {
                let bounds = axes.getBounds();
                this._xmin = bounds.x1;
                this._xmax = bounds.x2;
                this._ymin = bounds.y3;
                this._ymax = bounds.y4;
            }
        }

        return {
            xmin: ["X_min", "Units", this._xmin],
            delx: ["ΔX Step", "Units", this._delx],
            xmax: ["X_max", "Units", this._xmax],
            ymin: ["Y_min", "Units", this._ymin],
            ymax: ["Y_max", "Units", this._ymax],
            lineWidth: ["Line width", "Px", this._lineWidth]
        };
    }

    setParams(params) {
        this._xmin = parseFloat(params.xmin);
        this._delx = parseFloat(params.delx);
        this._xmax = parseFloat(params.xmax);
        this._ymin = parseFloat(params.ymin);
        this._ymax = parseFloat(params.ymax);
        this._lineWidth = parseFloat(params.lineWidth);
    }

    getParams() {
        return {
            xmin: this._xmin,
            delx: this._delx,
            xmax: this._xmax,
            ymin: this._ymin,
            ymax: this._ymax,
            lineWidth: this._lineWidth
        };
    }

    serialize() {
        return this._wasRun ? {
                algoType: "AveragingWindowWithStepSizeAlgo",
                xmin: this._xmin,
                delx: this._delx,
                xmax: this._xmax,
                ymin: this._ymin,
                ymax: this._ymax,
                lineWidth: this._lineWidth
            } :
            null;
    }

    deserialize(obj) {
        this._xmin = obj.xmin;
        this._delx = obj.delx;
        this._xmax = obj.xmax;
        this._ymin = obj.ymin;
        this._ymax = obj.ymax;
        this._lineWidth = obj.lineWidth;
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        var pointsPicked = 0,
            dw = autoDetector.imageWidth,
            dh = autoDetector.imageHeight,
            blobx = [],
            bloby = [],
            xi, xmin_pix, xmax_pix, ymin_pix, ymax_pix, dpix,
            r_unit_per_pix, step_pix, blobActive, blobEntry, blobExit, blobExitLocked, ii, yi,
            mean_ii, mean_yi, pdata;

        dataSeries.clearAll();

        for (xi = this._xmin; xi <= this._xmax; xi += this._delx) {
            step_pix = 1;

            pdata = axes.dataToPixel(xi, this._ymin);
            xmin_pix = pdata.x;
            ymin_pix = pdata.y;

            pdata = axes.dataToPixel(xi, this._ymax);
            xmax_pix = pdata.x;
            ymax_pix = pdata.y;

            dpix = Math.sqrt((ymax_pix - ymin_pix) * (ymax_pix - ymin_pix) +
                (xmax_pix - xmin_pix) * (xmax_pix - xmin_pix));
            r_unit_per_pix = (this._ymax - this._ymin) / dpix;

            blobActive = false;
            blobEntry = 0;
            blobExit = 0;
            // To account for noise or if actual thickness is less than specified thickness.
            // This flag helps to set blobExit at the end of the thin part or account for noise.
            blobExitLocked = false;

            for (ii = 0; ii <= dpix; ii++) {
                yi = -ii * step_pix * r_unit_per_pix + this._ymax;
                pdata = axes.dataToPixel(xi, yi);
                xi_pix = pdata.x;
                yi_pix = pdata.y;

                if (xi_pix >= 0 && xi_pix < dw && yi_pix >= 0 && yi_pix < dh) {
                    if (autoDetector.binaryData.has(parseInt(yi_pix, 10) * dw +
                            parseInt(xi_pix, 10))) {
                        if (blobActive === false) {
                            blobEntry = ii;
                            blobExit = blobEntry;
                            blobActive = true;
                            blobExitLocked = false;
                        }
                        // Resume collection, it was just noise
                        if (blobExitLocked === true) {
                            blobExit = ii;
                            blobExitLocked = false;
                        }
                    } else {

                        // collection ended before line thickness was hit. It could just be noise
                        // or it could be the actual end.
                        if (blobExitLocked === false) {
                            blobExit = ii;
                            blobExitLocked = true;
                        }
                    }

                    if (blobActive === true) {

                        if ((ii > blobEntry + this._lineWidth) || (ii == dpix - 1)) {
                            blobActive = false;

                            if (blobEntry > blobExit) {
                                blobExit = ii;
                            }

                            mean_ii = (blobEntry + blobExit) / 2.0;
                            mean_yi = -mean_ii * step_pix * r_unit_per_pix + this._ymax;

                            pdata = axes.dataToPixel(xi, mean_yi);
                            dataSeries.addPixel(parseFloat(pdata.x), parseFloat(pdata.y));
                            pointsPicked = pointsPicked + 1;
                        }
                    }
                }
            }
        }
    }
}/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.BarValue = class {

    constructor() {
        this.npoints = 0;
        this.avgValTop = 0;
        this.avgValBot = 0;
        this.avgX = 0;
    }

    append(x, valTop, valBot) {
        this.avgX = (this.npoints * this.avgX + x) / (this.npoints + 1.0);
        this.avgValTop = (this.npoints * this.avgValTop + valTop) / (this.npoints + 1.0);
        this.avgValBot = (this.npoints * this.avgValBot + valBot) / (this.npoints + 1.0);
        this.npoints++;
    }

    isPointInGroup(x, valTop, valBot, del_x, del_val) {
        if (this.npoints === 0) {
            return true;
        }
        if (Math.abs(this.avgX - x) <= del_x && Math.abs(this.avgValTop - valTop) <= del_val &&
            Math.abs(this.avgValBot - valBot) <= del_val) {
            return true;
        }
        return false;
    }
};

wpd.BarExtractionAlgo = class {

    constructor() {
        this._delX = 30;
        this._delVal = 10;
        this._wasRun = false;
    }

    getParamList(axes) {
        var orientationAxes = axes.getOrientation().axes;
        if (orientationAxes === 'Y') {
            return {
                delX: ['ΔX', 'Px', this._delX],
                delVal: ['ΔVal', 'Px', this._delVal]
            };
        } else {
            return {
                delX: ['ΔY', 'Px', this._delX],
                delVal: ['ΔVal', 'Px', this._delVal]
            };
        }
    }

    setParams(params) {
        this._delX = parseFloat(params.delX);
        this._delVal = parseFloat(params.delVal);
    }

    getParams(params) {
        return {
            delX: this._delX,
            delVal: this._delVal
        };
    }

    serialize() {
        return this._wasRun ? {
                algoType: "BarExtractionAlgo",
                delX: this._delX,
                delVal: this._delVal
            } :
            null;
    }

    deserialize(obj) {
        this._delX = obj.delX;
        this._delVal = obj.delVal;
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        var orientation = axes.getOrientation(),
            barValueColl = [],
            valTop, valBot, valCount, val,
            px, py, width = autoDetector.imageWidth,
            height = autoDetector.imageHeight,
            pixelAdded,
            barValuei, bv, dataVal, pxVal, mkeys, topVal, botVal,

            appendData = function(x, valTop, valBot, delX, delVal) {
                pixelAdded = false;
                for (barValuei = 0; barValuei < barValueColl.length; barValuei++) {
                    bv = barValueColl[barValuei];

                    if (bv.isPointInGroup(x, valTop, valBot, delX, delVal)) {
                        bv.append(x, valTop, valBot);
                        pixelAdded = true;
                        break;
                    }
                }
                if (!pixelAdded) {
                    bv = new wpd.BarValue();
                    bv.append(x, valTop, valBot);
                    barValueColl.push(bv);
                }
            };

        dataSeries.clearAll();

        // Switch directions based on axes orientation and direction of data along that axes:
        // For each direction, look for both top and bottom side of the bar to account for cases
        // where some bars are oriented in the increasing direction, while others are in a
        // decreasing direction
        if (orientation.axes === 'Y') {
            for (px = 0; px < width; px++) {
                valTop = 0;
                valBot = height - 1;
                valCount = 0;

                for (py = 0; py < height; py++) {
                    if (autoDetector.binaryData.has(py * width + px)) {
                        valTop = py;
                        valCount++;
                        break;
                    }
                }
                for (py = height - 1; py >= 0; py--) {
                    if (autoDetector.binaryData.has(py * width + px)) {
                        valBot = py;
                        valCount++;
                        break;
                    }
                }
                if (valCount === 2) { // found both top and bottom ends
                    appendData(px, valTop, valBot, this._delX, this._delVal);
                }
            }
        } else {
            for (py = 0; py < height; py++) {
                valTop = width - 1;
                valBot = 0;
                valCount = 0;

                for (px = width - 1; px >= 0; px--) {
                    if (autoDetector.binaryData.has(py * width + px)) {
                        valTop = px;
                        valCount++;
                        break;
                    }
                }
                for (px = 0; px < width; px++) {
                    if (autoDetector.binaryData.has(py * width + px)) {
                        valBot = px;
                        valCount++;
                        break;
                    }
                }
                if (valCount === 2) {
                    appendData(py, valTop, valBot, this._delX, this._delVal);
                }
            }
        }

        if (axes.dataPointsHaveLabels) {
            mkeys = dataSeries.getMetadataKeys();
            if (mkeys == null || mkeys[0] !== 'label') {
                dataSeries.setMetadataKeys(['label']);
            }
        }

        for (barValuei = 0; barValuei < barValueColl.length; barValuei++) {

            bv = barValueColl[barValuei];

            if (orientation.axes === 'Y') {
                valTop = axes.pixelToData(bv.avgX, bv.avgValTop)[0];
                valBot = axes.pixelToData(bv.avgX, bv.avgValBot)[0];
            } else {
                valTop = axes.pixelToData(bv.avgValTop, bv.avgX)[0];
                valBot = axes.pixelToData(bv.avgValBot, bv.avgX)[0];
            }

            if (valTop + valBot < 0) {
                val = orientation.direction === 'increasing' ? bv.avgValBot : bv.avgValTop;
            } else {
                val = orientation.direction === 'increasing' ? bv.avgValTop : bv.avgValBot;
            }

            if (axes.dataPointsHaveLabels) {

                if (orientation.axes === 'Y') {
                    dataSeries.addPixel(bv.avgX + 0.5, val + 0.5, {
                        "label": "Bar" + barValuei
                    });
                } else {
                    dataSeries.addPixel(val + 0.5, bv.avgX + 0.5, {
                        "label": "Bar" + barValuei
                    });
                }

            } else {

                if (orientation.axes === 'Y') {
                    dataSeries.addPixel(bv.avgX + 0.5, val + 0.5);
                } else {
                    dataSeries.addPixel(val + 0.5, bv.avgX + 0.5);
                }
            }
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.BlobDetectorAlgo = class {

    constructor() {
        this._minDia = 0;
        this._maxDia = 5000;
        this._wasRun = false;
    }

    getParamList(axes) {
        if (axes != null && axes instanceof wpd.MapAxes) {
            return {
                minDia: ['Min Diameter', 'Units', this._minDia],
                maxDia: ['Max Diameter', 'Units', this._maxDia]
            };
        }
        return {
            minDia: ['Min Diameter', 'Px', this._minDia],
            maxDia: ['Max Diameter', 'Px', this._maxDia]
        };
    }

    serialize() {
        return this._wasRun ? {
                algoType: "BlobDetectorAlgo",
                minDia: this._minDia,
                maxDia: this._maxDia
            } :
            null;
    }

    deserialize(obj) {
        this._minDia = obj.minDia;
        this._maxDia = obj.maxDia;
        this._wasRun = true;
    }

    setParams(params) {
        this._minDia = parseFloat(params.minDia);
        this._maxDia = parseFloat(params.maxDia);
    }

    getParams() {
        return {
            minDia: this._minDia,
            maxDia: this._maxDia
        };
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        var dw = autoDetector.imageWidth,
            dh = autoDetector.imageHeight,
            pixelVisited = [],
            blobCount = 0,
            blobs = [],
            xi, yi, blobPtIndex, bIndex, nxi, nyi, bxi, byi, pcount, dia;

        if (dw <= 0 || dh <= 0 || autoDetector.binaryData == null ||
            autoDetector.binaryData.size === 0) {
            return;
        }

        dataSeries.clearAll();
        dataSeries.setMetadataKeys(["area", "moment"]);

        for (xi = 0; xi < dw; xi++) {
            for (yi = 0; yi < dh; yi++) {
                if (autoDetector.binaryData.has(yi * dw + xi) &&
                    !(pixelVisited[yi * dw + xi] === true)) {

                    pixelVisited[yi * dw + xi] = true;

                    bIndex = blobs.length;

                    blobs[bIndex] = {
                        pixels: [{
                            x: xi,
                            y: yi
                        }],
                        centroid: {
                            x: xi,
                            y: yi
                        },
                        area: 1.0,
                        moment: 0.0
                    };

                    blobPtIndex = 0;
                    while (blobPtIndex < blobs[bIndex].pixels.length) {
                        bxi = blobs[bIndex].pixels[blobPtIndex].x;
                        byi = blobs[bIndex].pixels[blobPtIndex].y;

                        for (nxi = bxi - 1; nxi <= bxi + 1; nxi++) {
                            for (nyi = byi - 1; nyi <= byi + 1; nyi++) {
                                if (nxi >= 0 && nyi >= 0 && nxi < dw && nyi < dh) {
                                    if (!(pixelVisited[nyi * dw + nxi] === true) &&
                                        autoDetector.binaryData.has(nyi * dw + nxi)) {

                                        pixelVisited[nyi * dw + nxi] = true;

                                        pcount = blobs[bIndex].pixels.length;

                                        blobs[bIndex].pixels[pcount] = {
                                            x: nxi,
                                            y: nyi
                                        };

                                        blobs[bIndex].centroid.x =
                                            (blobs[bIndex].centroid.x * pcount + nxi) /
                                            (pcount + 1.0);
                                        blobs[bIndex].centroid.y =
                                            (blobs[bIndex].centroid.y * pcount + nyi) /
                                            (pcount + 1.0);
                                        blobs[bIndex].area = blobs[bIndex].area + 1.0;
                                    }
                                }
                            }
                        }
                        blobPtIndex = blobPtIndex + 1;
                    }
                }
            }
        }

        for (bIndex = 0; bIndex < blobs.length; bIndex++) {
            blobs[bIndex].moment = 0;
            for (blobPtIndex = 0; blobPtIndex < blobs[bIndex].pixels.length; blobPtIndex++) {
                blobs[bIndex].moment =
                    blobs[bIndex].moment +
                    (blobs[bIndex].pixels[blobPtIndex].x - blobs[bIndex].centroid.x) *
                    (blobs[bIndex].pixels[blobPtIndex].x - blobs[bIndex].centroid.x) +
                    (blobs[bIndex].pixels[blobPtIndex].y - blobs[bIndex].centroid.y) *
                    (blobs[bIndex].pixels[blobPtIndex].y - blobs[bIndex].centroid.y);
            }
            if (axes instanceof wpd.MapAxes) {
                blobs[bIndex].area = plotData.axes.pixelToDataArea(blobs[bIndex].area);
            }

            dia = 2.0 * Math.sqrt(blobs[bIndex].area / Math.PI);
            if (dia <= this._maxDia && dia >= this._minDia) {
                // add 0.5 pixel offset to shift to the center of the pixels.
                dataSeries.addPixel(blobs[bIndex].centroid.x + 0.5, blobs[bIndex].centroid.y + 0.5,
                    {"area": blobs[bIndex].area, "moment": blobs[bIndex].moment});
            }
        }
    }
}/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// Simple curve extraction with interpolation, but at user provided independents (x, theta etc.)
wpd.CustomIndependents = class {
    constructor() {
        this._xvals = [];
        this._ymin = 0;
        this._ymax = 0;
        this._curveWidth = 5;
        this._wasRun = false;
    }

    deserialize(obj) {
        this._xvals = obj.xvals;
        this._ymin = obj.ymin;
        this._ymax = obj.ymax;
        this._curveWidth = obj.curveWidth;
        this._wasRun = true;
    }

    setParams(params) {
        this._xvals = params.xvals;
        this._ymin = parseFloat(params.ymin);
        this._ymax = parseFloat(params.ymax);
        this._curveWidth = parseFloat(params.curveWidth);
    }

    getParams() {
        return {
            xvals: this._xvals,
            ymin: this._ymin,
            ymax: this._ymax,
            curveWidth: this._curveWidth
        };
    }

    getParamList(axes) {
        if (!this._wasRun) {
            if (axes != null && axes instanceof wpd.XYAxes) {
                let bounds = axes.getBounds();
                this._xvals = "[" + bounds.x1 + ", " + bounds.x2 + "]";
                this._ymin = bounds.y3;
                this._ymax = bounds.y4;
                this._curveWidth = 5;
            }
        }
        return {
            xvals: ["X Values", "Array", this._xvals],
            ymin: ["Y min", "Units", this._ymin],
            ymax: ["Y max", "Units", this._ymax],
            curveWidth: ["Curve Width", "Px", this._curveWidth]
        };
    }

    serialize() {
        return this._wasRun ? {
            algoType: "CustomIndependents",
            xvals: this._xvals,
            ymin: this._ymin,
            ymax: this._ymax,
            curveWidth: this._curveWidth
        } : null;
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        dataSeries.clearAll();

        let inputParser = new wpd.InputParser();
        let parsedVals = inputParser.parse(this._xvals);
        if (parsedVals == null || !inputParser.isArray) {
            return;
        }
        let isLogX = axes.isLogX();
        let isLogY = axes.isLogY();
        let isLogXNegative = axes.isLogXNegative();
        let isLogYNegative = axes.isLogYNegative();
        let logXFactor = isLogXNegative ? -1.0 : 1.0;
        let logYFactor = isLogYNegative ? -1.0 : 1.0;
        if (isLogXNegative) {
            parsedVals.sort((a, b) => {
                return b - a;
            });
        } else {
            parsedVals.sort((a, b) => {
                return a - b;
            });
        }
        let xmin = parsedVals[0];
        let xmax = parsedVals[parsedVals.length - 1];
        let ymin = this._ymin;
        let ymax = this._ymax;

        let scaled_xmin = xmin;
        let scaled_xmax = xmax;
        let scaled_ymin = ymin;
        let scaled_ymax = ymax;

        if (isLogX) {
            scaled_xmin = Math.log10(logXFactor * scaled_xmin);
            scaled_xmax = Math.log10(logXFactor * scaled_xmax);
        }
        if (isLogY) {
            scaled_ymin = Math.log10(logYFactor * scaled_ymin);
            scaled_ymax = Math.log10(logYFactor * scaled_ymax);
        }

        // pixel distance between xmin and xmax, ymin and ymax:
        let xmin_ymin_px = axes.dataToPixel(xmin, this._ymin);
        let xmax_ymin_px = axes.dataToPixel(xmax, this._ymin);
        let xmin_ymax_px = axes.dataToPixel(xmin, this._ymax);
        let distX = Math.sqrt((xmin_ymin_px.x - xmax_ymin_px.x) * (xmin_ymin_px.x - xmax_ymin_px.x) + (xmin_ymin_px.y - xmax_ymin_px.y) * (xmin_ymin_px.y - xmax_ymin_px.y));
        let distY = Math.sqrt((xmin_ymin_px.x - xmin_ymax_px.x) * (xmin_ymin_px.x - xmin_ymax_px.x) + (xmin_ymin_px.y - xmin_ymax_px.y) * (xmin_ymin_px.y - xmin_ymax_px.y));

        // change in axes units per pixel:
        let delX = (scaled_xmax - scaled_xmin) / distX;
        let delY = (scaled_ymax - scaled_ymin) / distY;

        let imageWidth = autoDetector.imageWidth;
        let imageHeight = autoDetector.imageHeight;
        let xpoints = [];
        let ypoints = [];

        let overflowPixels = this._curveWidth > 2.0 ? this._curveWidth : 2.0;
        for (let xi = scaled_xmin - overflowPixels * delX; xi <= scaled_xmax + overflowPixels * delX; xi += delX) {
            let mean_yi = 0;
            let y_count = 0;
            let yi = delY > 0 ? scaled_ymin : scaled_ymax;
            while ((delY > 0 && yi <= scaled_ymax) || (delY < 0 && yi <= scaled_ymin)) {
                let px = axes.dataToPixel(isLogX ? (logXFactor * Math.pow(10, xi)) : xi, isLogY ? (logYFactor * Math.pow(10, yi)) : yi);
                if (px.x >= 0 && px.y >= 0 && px.x < imageWidth && px.y < imageHeight) {
                    if (autoDetector.binaryData.has(parseInt(px.y, 10) * imageWidth +
                            parseInt(px.x, 10))) {
                        mean_yi += yi;
                        y_count++;
                    }
                }
                yi += Math.abs(delY);
            }

            if (y_count > 0) {
                mean_yi /= y_count;
                xpoints.push(parseFloat(xi));
                ypoints.push(parseFloat(mean_yi));
            }
        }

        if (xpoints.length <= 0 || ypoints.length <= 0) {
            return;
        }

        let xpointsMean = [];
        let ypointsMean = [];
        if (this._curveWidth > 0) {
            let stepSize = parseInt(this._curveWidth / 2, 10);
            if (stepSize < 1) {
                stepSize = 1;
            }
            for (let ptIdx = 0; ptIdx < xpoints.length; ptIdx += stepSize) {
                let meanX = 0;
                let meanY = 0;
                let neighborCount = 0;
                let currPx = axes.dataToPixel(isLogX ? logXFactor * Math.pow(10, xpoints[ptIdx]) : xpoints[ptIdx], isLogY ? logYFactor * Math.pow(10, ypoints[ptIdx]) : ypoints[ptIdx]);
                for (let nIdx = 0; nIdx < xpoints.length; nIdx++) {
                    let nPx = axes.dataToPixel(isLogX ? logXFactor * Math.pow(10, xpoints[nIdx]) : xpoints[nIdx], isLogY ? logYFactor * Math.pow(10, ypoints[nIdx]) : ypoints[nIdx]);
                    if (Math.abs(currPx.x - nPx.x) < this._curveWidth && Math.abs(currPx.y - nPx.y) < this._curveWidth) {
                        meanX += xpoints[nIdx];
                        meanY += ypoints[nIdx];
                        neighborCount++;
                    }
                }
                meanX /= neighborCount;
                meanY /= neighborCount;
                xpointsMean.push(meanX);
                ypointsMean.push(meanY);
            }
        } else {
            xpointsMean = xpoints;
            ypointsMean = ypoints;
        }

        // Cubic spline
        let cs = wpd.cspline(xpointsMean, ypointsMean);
        if (cs == null) {
            return;
        }

        for (let ptIdx = 0; ptIdx < parsedVals.length; ptIdx++) {
            if (isNaN(parsedVals[ptIdx])) {
                continue;
            }

            let yinterp = wpd.cspline_interp(cs, isLogX ? Math.log10(logXFactor * parsedVals[ptIdx]) : parsedVals[ptIdx]);
            if (yinterp == null) {
                continue;
            }

            let px = axes.dataToPixel(parsedVals[ptIdx], isLogY ? logYFactor * Math.pow(10, yinterp) : yinterp);
            dataSeries.addPixel(px.x, px.y);
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.XStepWithInterpolationAlgo = class {
    constructor() {
        this._xmin = 0;
        this._xmax = 1;
        this._delx = 0.1;
        this._smoothing = 0;
        this._ymin = 0;
        this._ymax = 0;
        this._wasRun = false;
    }

    getParamList(axes) {
        if (!this._wasRun) {
            if (axes != null && axes instanceof wpd.XYAxes) {
                let bounds = axes.getBounds();
                this._xmin = bounds.x1;
                this._xmax = bounds.x2;
                this._delx = (bounds.x2 - bounds.x1) / 50.0;
                this._ymin = bounds.y3;
                this._ymax = bounds.y4;
                this._smoothing = 0;
            }
        }
        return {
            xmin: ["X_min", "Units", this._xmin],
            delx: ["ΔX Step", "Units", this._delx],
            xmax: ["X_max", "Units", this._xmax],
            ymin: ["Y_min", "Units", this._ymin],
            ymax: ["Y_max", "Units", this._ymax],
            smoothing: ["Smoothing", "% of ΔX", this._smoothing]
        };
    }

    setParams(params) {
        this._xmin = parseFloat(params.xmin);
        this._delx = parseFloat(params.delx);
        this._xmax = parseFloat(params.xmax);
        this._ymin = parseFloat(params.ymin);
        this._ymax = parseFloat(params.ymax);
        this._smoothing = parseFloat(params.smoothing);
    }

    getParams() {
        return {
            xmin: this._xmin,
            delx: this._delx,
            xmax: this._xmax,
            ymin: this._ymin,
            ymax: this._ymax,
            smoothing: this._smoothing
        };
    }

    serialize() {
        return this._wasRun ? {
                algoType: "XStepWithInterpolationAlgo",
                xmin: this._xmin,
                delx: this._delx,
                xmax: this._xmax,
                ymin: this._ymin,
                ymax: this._ymax,
                smoothing: this._smoothing
            } :
            null;
    }

    deserialize(obj) {
        this._xmin = obj.xmin;
        this._delx = obj.delx;
        this._xmax = obj.xmax;
        this._ymin = obj.ymin;
        this._ymax = obj.ymax;
        this._smoothing = obj.smoothing;
        this._wasRun = true;
    }

    run(autoDetector, dataSeries, axes) {
        this._wasRun = true;
        var pointsPicked = 0,
            dw = autoDetector.imageWidth,
            dh = autoDetector.imageHeight,
            xi,
            dist_y_px, dist_x_px, ii, yi, jj, mean_yi, y_count, pdata, pdata0, pdata1, xpoints = [],
            ypoints = [],
            xpoints_mean = [],
            ypoints_mean = [],
            mean_x, mean_y, delx, dely, xinterp,
            yinterp, param_width = Math.abs(this._delx * (this._smoothing / 100.0)),
            cs,
            isLogX = axes.isLogX(),
            isLogY = axes.isLogY(),
            isLogXNegative = axes.isLogXNegative(),
            isLogYNegative = axes.isLogYNegative(),
            logXFactor = isLogXNegative ? -1.0 : 1.0,
            logYFactor = isLogYNegative ? -1.0 : 1.0,
            isDateX = axes.isDate(0),
            isDateY = axes.isDate(1),
            scaled_param_xmin = this._xmin,
            scaled_param_xmax = this._xmax,
            scaled_param_ymin = this._ymin,
            scaled_param_ymax = this._ymax,
            scaled_param_width = param_width,
            scaled_param_delx = this._delx;

        dataSeries.clearAll();

        if (isLogX) {
            scaled_param_xmax = Math.log10(logXFactor * scaled_param_xmax);
            scaled_param_xmin = Math.log10(logXFactor * scaled_param_xmin);
            scaled_param_width = Math.abs(Math.log10(logXFactor * this._delx) * this._smoothing / 100.0);
            scaled_param_delx = logXFactor * Math.log10(logXFactor * scaled_param_delx);
        }
        if (isLogY) {
            scaled_param_ymin = Math.log10(logYFactor * scaled_param_ymin);
            scaled_param_ymax = Math.log10(logYFactor * scaled_param_ymax);
        }

        // Calculate pixel distance between y_min and y_max:
        pdata0 = axes.dataToPixel(this._xmin, this._ymin);
        pdata1 = axes.dataToPixel(this._xmin, this._ymax);
        dist_y_px = Math.sqrt((pdata0.x - pdata1.x) * (pdata0.x - pdata1.x) +
            (pdata0.y - pdata1.y) * (pdata0.y - pdata1.y));
        dely = (scaled_param_ymax - scaled_param_ymin) / dist_y_px;

        // Calculate pixel distance between x_min and x_max:
        pdata1 = axes.dataToPixel(this._xmax, this._ymin);
        dist_x_px = Math.sqrt((pdata0.x - pdata1.x) * (pdata0.x - pdata1.x) +
            (pdata0.y - pdata1.y) * (pdata0.y - pdata1.y));
        delx = (scaled_param_xmax - scaled_param_xmin) / dist_x_px;

        if (Math.abs(scaled_param_width / delx) > 0 && Math.abs(scaled_param_width / delx) < 1) {
            scaled_param_width = delx;
        }

        xi = delx > 0 ? scaled_param_xmin - 2 * delx : scaled_param_xmin + 2 * delx;
        while ((delx > 0 && xi <= scaled_param_xmax + 2 * delx) ||
            (delx < 0 && xi >= scaled_param_xmax - 2 * delx)) {

            mean_yi = 0;
            y_count = 0;
            yi = scaled_param_ymin;
            while ((dely > 0 && yi <= scaled_param_ymax) || (dely < 0 && yi >= scaled_param_ymax)) {
                pdata = axes.dataToPixel(isLogX ? logXFactor * Math.pow(10, xi) : xi,
                    isLogY ? logYFactor * Math.pow(10, yi) : yi);
                if (pdata.x >= 0 && pdata.y >= 0 && pdata.x < dw && pdata.y < dh) {
                    if (autoDetector.binaryData.has(parseInt(pdata.y, 10) * dw +
                            parseInt(pdata.x, 10))) {
                        mean_yi = (mean_yi * y_count + yi) / (parseFloat(y_count + 1));
                        y_count++;
                    }
                }
                yi = yi + dely;
            }

            if (y_count > 0) {
                xpoints[pointsPicked] = parseFloat(xi);
                ypoints[pointsPicked] = parseFloat(mean_yi);
                pointsPicked = pointsPicked + 1;
            }

            xi = xi + delx;
        }

        if (xpoints.length <= 0 || ypoints.length <= 0) {
            return; // kill if nothing was detected so far.
        }

        if (scaled_param_width > 0) {
            xpoints_mean = [];
            ypoints_mean = [];

            xi = xpoints[0];
            while ((delx > 0 && xi <= xpoints[xpoints.length - 1]) ||
                (delx < 0 && xi >= xpoints[xpoints.length - 1])) {
                mean_x = 0;
                mean_y = 0;
                y_count = 0;
                for (ii = 0; ii < xpoints.length; ii++) {
                    if (xpoints[ii] <= xi + scaled_param_width &&
                        xpoints[ii] >= xi - scaled_param_width) {
                        mean_x = (mean_x * y_count + xpoints[ii]) / parseFloat(y_count + 1);
                        mean_y = (mean_y * y_count + ypoints[ii]) / parseFloat(y_count + 1);
                        y_count++;
                    }
                }

                if (y_count > 0) {
                    xpoints_mean[xpoints_mean.length] = mean_x;
                    ypoints_mean[ypoints_mean.length] = mean_y;
                }

                if (delx > 0) {
                    xi = xi + param_width;
                } else {
                    xi = xi - param_width;
                }
            }

        } else {
            xpoints_mean = xpoints;
            ypoints_mean = ypoints;
        }

        if (xpoints_mean.length <= 0 || ypoints_mean.length <= 0) {
            return;
        }

        xinterp = [];
        ii = 0;
        xi = scaled_param_xmin;

        if ((delx < 0 && this._delx > 0) || (delx > 0 && this._delx < 0)) {
            return;
        }

        while ((delx > 0 && xi <= scaled_param_xmax) || (delx < 0 && xi >= scaled_param_xmax)) {
            xinterp[ii] = xi;
            ii++;
            xi = xi + scaled_param_delx;
        }

        if (delx < 0) {
            xpoints_mean = xpoints_mean.reverse();
            ypoints_mean = ypoints_mean.reverse();
        }

        // Cubic spline interpolation:
        cs = wpd.cspline(xpoints_mean, ypoints_mean);
        if (cs != null) {
            yinterp = [];
            for (ii = 0; ii < xinterp.length; ++ii) {
                if (!isNaN(xinterp[ii])) {
                    yinterp[ii] = wpd.cspline_interp(cs, xinterp[ii]);
                    if (yinterp[ii] !== null) {
                        pdata = axes.dataToPixel(isLogX ? logXFactor * Math.pow(10, xinterp[ii]) : xinterp[ii],
                            isLogY ? logYFactor * Math.pow(10, yinterp[ii]) : yinterp[ii]);
                        dataSeries.addPixel(pdata.x, pdata.y);
                    }
                }
            }
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.BarAxes = (function() {
    var AxesObj = function() {
        // Throughout this code, it is assumed that "y" is the continuous axes and "x" is
        // the discrete axes. In practice, this shouldn't matter even if the orientation
        // is different.
        var isCalibrated = false,
            isLogScale = false,
            isRotatedAxes = false,
            metadata = {},
            x1, y1, x2, y2, p1, p2,
            orientation;

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibration = null;

        this.calibrate = function(calibration, isLog, isRotated) {
            this.calibration = calibration;
            isCalibrated = false;
            var cp1 = calibration.getPoint(0),
                cp2 = calibration.getPoint(1);

            x1 = cp1.px;
            y1 = cp1.py;
            x2 = cp2.px;
            y2 = cp2.py;
            p1 = parseFloat(cp1.dy);
            p2 = parseFloat(cp2.dy);

            if (isLog) {
                isLogScale = true;
                p1 = Math.log(p1) / Math.log(10);
                p2 = Math.log(p2) / Math.log(10);
            } else {
                isLogScale = false;
            }

            orientation = this.calculateOrientation();
            isRotatedAxes = isRotated;

            if (!isRotated) {
                // ignore rotation and assume axes is precisely vertical or horizontal
                if (orientation.axes == 'Y') {
                    x2 = x1;
                } else {
                    y2 = y1;
                }
                // recalculate orientation:
                orientation = this.calculateOrientation();
            }

            isCalibrated = true;
            return true;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [],
                c_c2 = ((pyi - y1) * (y2 - y1) + (x2 - x1) * (pxi - x1)) /
                ((y2 - y1) * (y2 - y1) + (x2 - x1) * (x2 - x1));
            // We could return X pixel value (or Y, depending on orientation) but that's not very
            // useful. For now, just return the bar value. That's it.
            data[0] = (p2 - p1) * c_c2 + p1;
            if (isLogScale) {
                data[0] = Math.pow(10, data[0]);
            }
            return data;
        };

        this.dataToPixel = function(x, y) {
            // not implemented yet
            return {
                x: 0,
                y: 0
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var dataVal = this.pixelToData(pxi, pyi);
            return dataVal[0].toExponential(4);
        };

        this.isLog = function() {
            return isLogScale;
        };

        this.isRotated = function() {
            return isRotatedAxes;
        }

        this.dataPointsHaveLabels = true;

        this.dataPointsLabelPrefix = 'Bar';

        this.calculateOrientation = function() { // Used by auto-extract algo to switch orientation.
            var orientationAngle = wpd.taninverse(-(y2 - y1), x2 - x1) * 180 / Math.PI,
                orientation = {
                    axes: 'Y',
                    direction: 'increasing',
                    angle: orientationAngle
                },
                tol = 30; // degrees.

            if (Math.abs(orientationAngle - 90) < tol) {
                orientation.axes = 'Y';
                orientation.direction = 'increasing';
            } else if (Math.abs(orientationAngle - 270) < tol) {
                orientation.axes = 'Y';
                orientation.direction = 'decreasing';
            } else if (Math.abs(orientationAngle - 0) < tol ||
                Math.abs(orientationAngle - 360) < tol) {
                orientation.axes = 'X';
                orientation.direction = 'increasing';
            } else if (Math.abs(orientationAngle - 180) < tol) {
                orientation.axes = 'X';
                orientation.direction = 'decreasing';
            }

            return orientation;

        };

        this.getOrientation = function() {
            return orientation;
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "Bar";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 2;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['Label', 'Y'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.ImageAxes = (function() {
    var AxesObj = function() {
        let metadata = {};

        this.isCalibrated = function() {
            return true;
        };

        this.calibrate = function() {
            return true;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [pxi, pyi];
            return data;
        };

        this.dataToPixel = function(x, y) {
            return {
                x: x,
                y: y
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var dataVal = this.pixelToData(pxi, pyi);
            return dataVal[0].toFixed(2) + ', ' + dataVal[1].toFixed(2);
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "Image";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 0;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['X', 'Y'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.MapAxes = (function() {
    var AxesObj = function() {
        var isCalibrated = false,

            metadata = {},

            scaleLength, scaleUnits, dist,

            processCalibration = function(cal, scale_length, scale_units) {
                var cp0 = cal.getPoint(0),
                    cp1 = cal.getPoint(1);
                dist = Math.sqrt((cp0.px - cp1.px) * (cp0.px - cp1.px) +
                    (cp0.py - cp1.py) * (cp0.py - cp1.py));
                scaleLength = parseFloat(scale_length);
                scaleUnits = scale_units;
                return true;
            };

        this.calibration = null;

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibrate = function(calib, scale_length, scale_units) {
            this.calibration = calib;
            isCalibrated = processCalibration(calib, scale_length, scale_units);
            return isCalibrated;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [];
            data[0] = pxi * scaleLength / dist;
            data[1] = pyi * scaleLength / dist;
            return data;
        };

        this.pixelToDataDistance = function(distancePx) {
            return distancePx * scaleLength / dist;
        };

        this.pixelToDataArea = function(
            areaPx) {
            return areaPx * scaleLength * scaleLength / (dist * dist);
        };

        this.dataToPixel = function(a, b, c) {
            return {
                x: 0,
                y: 0
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var dataVal = this.pixelToData(pxi, pyi);
            return dataVal[0].toExponential(4) + ', ' + dataVal[1].toExponential(4);
        };

        this.getScaleLength = function() {
            return scaleLength;
        };

        this.getUnits = function() {
            return scaleUnits;
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "Map";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 2;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['X', 'Y'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.PolarAxes = (function() {
    var AxesObj = function() {
        var isCalibrated = false,
            isDegrees = false,
            isClockwise = false,
            isLog = false,

            metadata = {},

            x0, y0, x1, y1, x2, y2, r1, theta1, r2, theta2, dist10, dist20, dist12, phi0, alpha0;

        let processCalibration = function(cal, is_degrees, is_clockwise, is_log_r) {
            var cp0 = cal.getPoint(0),
                cp1 = cal.getPoint(1),
                cp2 = cal.getPoint(2);
            x0 = cp0.px;
            y0 = cp0.py;
            x1 = cp1.px;
            y1 = cp1.py;
            x2 = cp2.px;
            y2 = cp2.py;

            r1 = cp1.dx;
            theta1 = cp1.dy;

            r2 = cp2.dx;
            theta2 = cp2.dy;

            isDegrees = is_degrees;
            isClockwise = is_clockwise;

            if (isDegrees === true) { // if degrees
                theta1 = (Math.PI / 180.0) * theta1;
                theta2 = (Math.PI / 180.0) * theta2;
            }

            if (is_log_r) {
                isLog = true;
                r1 = Math.log(r1) / Math.log(10);
                r2 = Math.log(r2) / Math.log(10);
            }

            // Distance between 1 and 0.
            dist10 = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));

            // Distance between 2 and 0
            dist20 = Math.sqrt((x2 - x0) * (x2 - x0) + (y2 - y0) * (y2 - y0));

            // Radial Distance between 1 and 2.
            dist12 = dist20 - dist10;

            phi0 = wpd.taninverse(-(y1 - y0), x1 - x0);

            if (isClockwise) {
                alpha0 = phi0 + theta1;
            } else {
                alpha0 = phi0 - theta1;
            }

            return true;
        };

        this.calibration = null;

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibrate = function(calib, is_degrees, is_clockwise, is_log_r) {
            this.calibration = calib;
            isCalibrated = processCalibration(calib, is_degrees, is_clockwise, is_log_r);
            return isCalibrated;
        };

        this.isThetaDegrees = function() {
            return isDegrees;
        };

        this.isThetaClockwise = function() {
            return isClockwise;
        };

        this.isRadialLog = function() {
            return isLog;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [],
                rp, thetap;

            let xp = parseFloat(pxi);
            let yp = parseFloat(pyi);

            rp = ((r2 - r1) / dist12) *
                (Math.sqrt((xp - x0) * (xp - x0) + (yp - y0) * (yp - y0)) - dist10) +
                r1;

            if (isClockwise) {
                thetap = alpha0 - wpd.taninverse(-(yp - y0), xp - x0);
            } else {
                thetap = wpd.taninverse(-(yp - y0), xp - x0) - alpha0;
            }

            if (thetap < 0) {
                thetap = thetap + 2 * Math.PI;
            }

            if (isDegrees === true) {
                thetap = 180.0 * thetap / Math.PI;
            }

            if (isLog) {
                rp = Math.pow(10, rp);
            }

            data[0] = rp;
            data[1] = thetap;

            return data;
        };

        this.dataToPixel = function(r, theta) {
            return {
                x: 0,
                y: 0
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var dataVal = this.pixelToData(pxi, pyi);
            return dataVal[0].toExponential(4) + ', ' + dataVal[1].toExponential(4);
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "Polar";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 3;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['r', 'θ'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.TernaryAxes = (function() {
    var AxesObj = function() {
        var isCalibrated = false,

            metadata = {},

            x0, y0, x1, y1, x2, y2, L, phi0, root3, isRange0to100, isOrientationNormal,

            processCalibration = function(cal, range100, is_normal) {
                var cp0 = cal.getPoint(0),
                    cp1 = cal.getPoint(1),
                    cp2 = cal.getPoint(2);

                x0 = cp0.px;
                y0 = cp0.py;
                x1 = cp1.px;
                y1 = cp1.py;
                x2 = cp2.px;
                y2 = cp2.py;

                L = Math.sqrt((x0 - x1) * (x0 - x1) + (y0 - y1) * (y0 - y1));

                phi0 = wpd.taninverse(-(y1 - y0), x1 - x0);

                root3 = Math.sqrt(3);

                isRange0to100 = range100;

                isOrientationNormal = is_normal;

                return true;
            };

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibration = null;

        this.calibrate = function(calib, range100, is_normal) {
            this.calibration = calib;
            isCalibrated = processCalibration(calib, range100, is_normal);
            return isCalibrated;
        };

        this.isRange100 = function() {
            return isRange0to100;
        };

        this.isNormalOrientation = function() {
            return isOrientationNormal;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [],
                rp, thetap, xx, yy, ap, bp, cp, bpt;

            let xp = parseFloat(pxi);
            let yp = parseFloat(pyi);

            rp = Math.sqrt((xp - x0) * (xp - x0) + (yp - y0) * (yp - y0));

            thetap = wpd.taninverse(-(yp - y0), xp - x0) - phi0;

            xx = (rp * Math.cos(thetap)) / L;
            yy = (rp * Math.sin(thetap)) / L;

            ap = 1.0 - xx - yy / root3;
            bp = xx - yy / root3;
            cp = 2.0 * yy / root3;

            if (isOrientationNormal == false) {
                // reverse axes orientation
                bpt = bp;
                bp = ap;
                ap = cp;
                cp = bpt;
            }

            if (isRange0to100 == true) {
                ap = ap * 100;
                bp = bp * 100;
                cp = cp * 100;
            }

            data[0] = ap;
            data[1] = bp;
            data[2] = cp;
            return data;
        };

        this.dataToPixel = function(a, b, c) {
            return {
                x: 0,
                y: 0
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var dataVal = this.pixelToData(pxi, pyi);
            return dataVal[0].toExponential(4) + ', ' + dataVal[1].toExponential(4) + ', ' +
                dataVal[2].toExponential(4);
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "Ternary";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 3;
    };

    AxesObj.prototype.getDimensions = function() {
        return 3;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['a', 'b', 'c'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.XYAxes = (function() {
    var AxesObj = function() {
        var calibration, isCalibrated = false,
            isLogScaleX = false,
            isLogScaleY = false,
            isLogScaleXNegative = false,
            isLogScaleYNegative = false,

            isXDate = false,
            isYDate = false,
            noRotation = false,

            metadata = {},

            initialFormattingX, initialFormattingY,

            x1, x2, x3, x4, y1, y2, y3, y4, xmin, xmax, ymin, ymax,
            a_mat = [0, 0, 0, 0],
            a_inv_mat = [0, 0, 0, 0],
            c_vec = [0, 0],

            processCalibration = function(cal, isLogX, isLogY, noRotationCorrection) {
                if (cal.getCount() < 4) {
                    return false;
                }

                var cp1 = cal.getPoint(0),
                    cp2 = cal.getPoint(1),
                    cp3 = cal.getPoint(2),
                    cp4 = cal.getPoint(3),
                    ip = new wpd.InputParser(),
                    dat_mat, pix_mat;

                x1 = cp1.px;
                y1 = cp1.py;
                x2 = cp2.px;
                y2 = cp2.py;
                x3 = cp3.px;
                y3 = cp3.py;
                x4 = cp4.px;
                y4 = cp4.py;

                xmin = cp1.dx;
                xmax = cp2.dx;
                ymin = cp3.dy;
                ymax = cp4.dy;

                // Check for dates, validity etc.

                // Validate X-Axes:
                xmin = ip.parse(xmin);
                if (!ip.isValid) {
                    return false;
                }
                isXDate = ip.isDate;
                xmax = ip.parse(xmax);
                if (!ip.isValid || (ip.isDate != isXDate)) {
                    return false;
                }
                initialFormattingX = ip.formatting;

                // Validate Y-Axes:
                ymin = ip.parse(ymin);
                if (!ip.isValid) {
                    return false;
                }
                isYDate = ip.isDate;
                ymax = ip.parse(ymax);
                if (!ip.isValid || (ip.isDate != isYDate)) {
                    return false;
                }
                initialFormattingY = ip.formatting;

                isLogScaleX = isLogX;
                isLogScaleY = isLogY;
                noRotation = noRotationCorrection;

                // If x-axis is log scale
                if (isLogScaleX === true) {
                    if (xmin < 0 && xmax < 0) {
                        isLogScaleXNegative = true;
                        xmin = Math.log(-xmin) / Math.log(10);
                        xmax = Math.log(-xmax) / Math.log(10);
                    } else {
                        xmin = Math.log(xmin) / Math.log(10);
                        xmax = Math.log(xmax) / Math.log(10);
                    }
                }

                // If y-axis is log scale
                if (isLogScaleY === true) {
                    if (ymin < 0 && ymax < 0) {
                        isLogScaleYNegative = true;
                        ymin = Math.log(-ymin) / Math.log(10);
                        ymax = Math.log(-ymax) / Math.log(10);
                    } else {
                        ymin = Math.log(ymin) / Math.log(10);
                        ymax = Math.log(ymax) / Math.log(10);
                    }
                }

                dat_mat = [xmin - xmax, 0, 0, ymin - ymax];
                pix_mat = [x1 - x2, x3 - x4, y1 - y2, y3 - y4];

                a_mat = wpd.mat.mult2x2(dat_mat, wpd.mat.inv2x2(pix_mat));

                if (noRotation) {
                    // avoid rotating the axes if this is selected.
                    if (Math.abs(a_mat[0] * a_mat[3]) > Math.abs(a_mat[1] * a_mat[2])) {
                        // snap to zero deg
                        a_mat[1] = 0;
                        a_mat[2] = 0;
                        a_mat[0] = (xmax - xmin) / (x2 - x1);
                        a_mat[3] = (ymax - ymin) / (y4 - y3);
                    } else {
                        // snap to +/- 90 deg since it appears x-axis is vertical and y is horizontal
                        a_mat[0] = 0;
                        a_mat[3] = 0;
                        a_mat[1] = (xmax - xmin) / (y2 - y1);
                        a_mat[2] = (ymax - ymin) / (x4 - x3);
                    }
                }

                a_inv_mat = wpd.mat.inv2x2(a_mat);
                c_vec[0] = xmin - a_mat[0] * x1 - a_mat[1] * y1;
                c_vec[1] = ymin - a_mat[2] * x3 - a_mat[3] * y3;

                calibration = cal;
                return true;
            };

        this.getBounds = function() {
            return {
                x1: isLogScaleX ? Math.pow(10, xmin) : xmin,
                x2: isLogScaleX ? Math.pow(10, xmax) : xmax,
                y3: isLogScaleY ? Math.pow(10, ymin) : ymin,
                y4: isLogScaleY ? Math.pow(10, ymax) : ymax
            };
        };

        this.isCalibrated = function() {
            return isCalibrated;
        };

        this.calibration = null;

        this.calibrate = function(calib, isLogX, isLogY, noRotationCorrection) {
            this.calibration = calib;
            isCalibrated = processCalibration(calib, isLogX, isLogY, noRotationCorrection);
            return isCalibrated;
        };

        this.pixelToData = function(pxi, pyi) {
            var data = [],
                xp, yp, xf, yf, dat_vec;

            xp = parseFloat(pxi);
            yp = parseFloat(pyi);

            dat_vec = wpd.mat.mult2x2Vec(a_mat, [xp, yp]);
            dat_vec[0] = dat_vec[0] + c_vec[0];
            dat_vec[1] = dat_vec[1] + c_vec[1];

            xf = dat_vec[0];
            yf = dat_vec[1];

            // if x-axis is log scale
            if (isLogScaleX === true) {
                xf = isLogScaleXNegative ? -Math.pow(10, xf) : Math.pow(10, xf);
            }

            // if y-axis is log scale
            if (isLogScaleY === true) {
                yf = isLogScaleYNegative ? -Math.pow(10, yf) : Math.pow(10, yf);
            }

            data[0] = xf;
            data[1] = yf;

            return data;
        };

        this.dataToPixel = function(x, y) {
            var xf, yf, dat_vec, rtnPix;

            if (isLogScaleX) {
                x = isLogScaleXNegative ? Math.log(-x) / Math.log(10) : Math.log(x) / Math.log(10);
            }
            if (isLogScaleY) {
                y = isLogScaleYNegative ? Math.log(-y) / Math.log(10) : Math.log(y) / Math.log(10);
            }

            dat_vec = [x - c_vec[0], y - c_vec[1]];
            rtnPix = wpd.mat.mult2x2Vec(a_inv_mat, dat_vec);

            xf = rtnPix[0];
            yf = rtnPix[1];

            return {
                x: xf,
                y: yf
            };
        };

        this.pixelToLiveString = function(pxi, pyi) {
            var rtnString = '',
                dataVal = this.pixelToData(pxi, pyi);
            if (isXDate) {
                rtnString += wpd.dateConverter.formatDateNumber(dataVal[0], initialFormattingX);
            } else {
                rtnString += dataVal[0].toExponential(4);
            }
            rtnString += ', ';

            if (isYDate) {
                rtnString += wpd.dateConverter.formatDateNumber(dataVal[1], initialFormattingY);
            } else {
                rtnString += dataVal[1].toExponential(4);
            }
            return rtnString;
        };

        this.isDate = function(varIndex) {
            if (varIndex === 0) {
                return isXDate;
            } else {
                return isYDate;
            }
        };

        this.getInitialDateFormat = function(varIndex) {
            if (varIndex === 0) {
                return initialFormattingX;
            } else {
                return initialFormattingY;
            }
        };

        this.isLogX = function() {
            return isLogScaleX;
        };

        this.isLogXNegative = function() {
            return isLogScaleXNegative;
        }

        this.isLogY = function() {
            return isLogScaleY;
        };

        this.isLogYNegative = function() {
            return isLogScaleYNegative;
        }

        this.noRotation = function() {
            return noRotation;
        };

        this.getOrientation = function() {
            // Used by histogram auto-extract method only at the moment.
            // Just indicate increasing y-axis at the moment so that we can work with histograms.
            return {
                axes: 'Y',
                direction: 'increasing',
                angle: 90
            };
        };

        this.getMetadata = function() {
            // deep clone
            return JSON.parse(JSON.stringify(metadata));
        };

        this.setMetadata = function(obj) {
            // deep clone
            metadata = JSON.parse(JSON.stringify(obj));
        };

        this.name = "XY";
    };

    AxesObj.prototype.numCalibrationPointsRequired = function() {
        return 4;
    };

    AxesObj.prototype.getDimensions = function() {
        return 2;
    };

    AxesObj.prototype.getAxesLabels = function() {
        return ['X', 'Y'];
    };

    return AxesObj;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.dataTable = (function() {
    var dataProvider, dataCache, sortedData, tableText, selectedDataset, selectedMeasurement;

    var decSeparator = 1.1.toLocaleString().replace(/\d/g, '');

    function showPlotData() {
        dataProvider = wpd.plotDataProvider;
        selectedDataset = wpd.tree.getActiveDataset();
        selectedMeasurement = null;
        dataProvider.setDataSource(selectedDataset);
        show();
    }

    function showAngleData() {
        dataProvider = wpd.measurementDataProvider;
        selectedMeasurement = wpd.measurementModes.angle.getData();
        selectedDataset = null;
        dataProvider.setDataSource(selectedMeasurement);
        show();
    }

    function showDistanceData() {
        dataProvider = wpd.measurementDataProvider;
        selectedMeasurement = wpd.measurementModes.distance.getData();
        selectedDataset = null;
        dataProvider.setDataSource(selectedMeasurement);
        show();
    }

    function showAreaData() {
        dataProvider = wpd.measurementDataProvider;
        selectedMeasurement = wpd.measurementModes.area.getData();
        selectedDataset = null;
        dataProvider.setDataSource(selectedMeasurement);
        show();
    }

    function show() {
        wpd.graphicsWidget.removeTool();
        wpd.popup.show('csvWindow');
        initializeColSeparator();
        refresh();
    }

    function initializeColSeparator() {
        // avoid colSeparator === decSeparator
        if (document.getElementById('data-number-format-separator').value.trim() === decSeparator) {
            document.getElementById('data-number-format-separator').value =
                decSeparator === "," ? "; " : ", ";
        }
    }

    function refresh() {
        dataCache = dataProvider.getData();
        setupControls();
        sortRawData();
        makeTable();
    }

    function setupControls() {

        let $datasetList = document.getElementById('data-table-dataset-list');
        let $sortingVariables = document.getElementById('data-sort-variables');
        let $variableNames = document.getElementById('dataVariables');
        let $dateFormattingContainer = document.getElementById('data-date-formatting-container');
        let $dateFormatting = document.getElementById('data-date-formatting');
        let datasetHTML = '';
        let sortingHTML = '';
        let dateFormattingHTML = '';
        let isAnyVariableDate = false;
        let showDatasets = selectedDataset != null;
        let showMeasurements = selectedMeasurement != null;

        // gather names
        if (showDatasets) {
            let datasetNames = wpd.appData.getPlotData().getDatasetNames();
            datasetNames.forEach((name) => {
                datasetHTML += "<option value=\"" + name + "\">" + name + "</option>";
            });
            $datasetList.innerHTML = datasetHTML;
            $datasetList.value = selectedDataset.name;
        } else if (showMeasurements) {
            if (wpd.appData.getPlotData().getMeasurementsByType(wpd.AreaMeasurement).length > 0) {
                datasetHTML +=
                    "<option value=\"area\">" + wpd.gettext("area-measurements") + "</option>";
            }
            if (wpd.appData.getPlotData().getMeasurementsByType(wpd.AngleMeasurement).length > 0) {
                datasetHTML +=
                    "<option value=\"angle\">" + wpd.gettext("angle-measurements") + "</option>";
            }
            if (wpd.appData.getPlotData().getMeasurementsByType(wpd.DistanceMeasurement).length >
                0) {
                datasetHTML += "<option value=\"distance\">" +
                    wpd.gettext("distance-measurements") + "</option>";
            }
            $datasetList.innerHTML = datasetHTML;
            if (selectedMeasurement instanceof wpd.AngleMeasurement) {
                $datasetList.value = "angle";
            } else if (selectedMeasurement instanceof wpd.DistanceMeasurement) {
                $datasetList.value = "distance";
            } else if (selectedMeasurement instanceof wpd.AreaMeasurement) {
                $datasetList.value = "area";
            }
        }

        // Variable Names
        $variableNames.innerHTML = dataCache.fields.join(', ');

        $dateFormattingContainer.style.display = 'none';
        sortingHTML += '<option value="raw">' + wpd.gettext('raw') + '</option>';
        for (let i = 0; i < dataCache.fields.length; i++) {

            // Sorting
            if (dataCache.isFieldSortable[i]) {
                sortingHTML += '<option value="' + dataCache.fields[i] + '">' +
                    dataCache.fields[i] + '</option>';
            }

            // Date formatting
            if (dataCache.fieldDateFormat[i] != null) {
                dateFormattingHTML +=
                    '<p>' + dataCache.fields[i] + ' <input type="text" length="15" value="' +
                    dataCache.fieldDateFormat[i] + '" id="data-format-string-' + i + '"/></p>';
                isAnyVariableDate = true;
            }
        }
        if (dataCache.allowConnectivity) {
            sortingHTML +=
                '<option value="NearestNeighbor">' + wpd.gettext('nearest-neighbor') + '</option>';
        }
        $sortingVariables.innerHTML = sortingHTML;
        updateSortingControls();

        if (isAnyVariableDate) {
            $dateFormattingContainer.style.display = 'inline-block';
            $dateFormatting.innerHTML = dateFormattingHTML;
        } else {
            $dateFormattingContainer.style.display = 'hidden';
        }
    }

    function changeDataset() {
        var $datasetList = document.getElementById('data-table-dataset-list');
        if (selectedDataset != null) {
            selectedDataset = wpd.appData.getPlotData().getDatasets()[$datasetList.selectedIndex];
            dataProvider.setDataSource(selectedDataset);
        } else if (selectedMeasurement != null) {
            if ($datasetList.value === "angle") {
                selectedMeasurement =
                    wpd.appData.getPlotData().getMeasurementsByType(wpd.AngleMeasurement)[0];
            } else if ($datasetList.value === "distance") {
                selectedMeasurement =
                    wpd.appData.getPlotData().getMeasurementsByType(wpd.DistanceMeasurement)[0];
            } else if ($datasetList.value === "area") {
                selectedMeasurement =
                    wpd.appData.getPlotData().getMeasurementsByType(wpd.AreaMeasurement)[0];
            }
            dataProvider.setDataSource(selectedMeasurement);
        }
        refresh();
    }

    function updateSortingControls() {
        var sortingKey = document.getElementById('data-sort-variables').value,
            $sortingOrder = document.getElementById('data-sort-order'),
            isConnectivity = sortingKey === 'NearestNeighbor',
            isRaw = sortingKey === 'raw';

        if (isConnectivity || isRaw) {
            $sortingOrder.setAttribute('disabled', true);
        } else {
            $sortingOrder.removeAttribute('disabled');
        }
    }

    function reSort() {
        updateSortingControls();
        sortRawData();
        makeTable();
    }

    function sortRawData() {

        if (dataCache == null || dataCache.rawData == null) {
            return;
        }

        sortedData = dataCache.rawData.slice(0);
        var sortingKey = document.getElementById('data-sort-variables').value,
            sortingOrder = document.getElementById('data-sort-order').value,
            isAscending = sortingOrder === 'ascending',
            isRaw = sortingKey === 'raw',
            isConnectivity = sortingKey === 'NearestNeighbor',
            dataIndex,
            fieldCount = dataCache.fields.length;

        if (isRaw) {
            return;
        }

        if (!isConnectivity) {
            dataIndex = dataCache.fields.indexOf(sortingKey);
            if (dataIndex < 0) {
                return;
            }
            sortedData.sort(function(a, b) {
                if (a[dataIndex] > b[dataIndex]) {
                    return isAscending ? 1 : -1;
                } else if (a[dataIndex] < b[dataIndex]) {
                    return isAscending ? -1 : 1;
                }
                return 0;
            });
            return;
        }

        if (isConnectivity) {
            var mindist, compdist, minindex, rowi, rowcompi,
                rowCount = sortedData.length,
                connFieldIndices = dataCache.connectivityFieldIndices,
                fi, cfi, swp;

            for (rowi = 0; rowi < rowCount - 1; rowi++) {
                minindex = -1;

                // loop through all other points and find the nearest next neighbor
                for (rowcompi = rowi + 1; rowcompi < rowCount; rowcompi++) {
                    compdist = 0;
                    for (fi = 0; fi < connFieldIndices.length; fi++) {
                        cfi = connFieldIndices[fi];
                        compdist += (sortedData[rowi][cfi] - sortedData[rowcompi][cfi]) *
                            (sortedData[rowi][cfi] - sortedData[rowcompi][cfi]);
                    }

                    if ((compdist < mindist) || (minindex === -1)) {
                        mindist = compdist;
                        minindex = rowcompi;
                    }
                }

                // swap (minindex) and (rowi+1) rows
                for (fi = 0; fi < dataCache.fields.length; fi++) {
                    swp = sortedData[minindex][fi];
                    sortedData[minindex][fi] = sortedData[rowi + 1][fi];
                    sortedData[rowi + 1][fi] = swp;
                }
            }
        }
    }

    function makeTable() {
        if (sortedData == null) {
            return;
        }

        var $digitizedDataTable = document.getElementById('digitizedDataTable'),
            numFormattingDigits =
            parseInt(document.getElementById('data-number-format-digits').value, 10),
            numFormattingStyle = document.getElementById('data-number-format-style').value,
            colSeparator = document.getElementById('data-number-format-separator').value,
            rowi,
            coli, rowValues, dateFormattingStrings = [];

        // "\t" in the column separator should translate to a tab:
        colSeparator = colSeparator.replace(/[^\\]\\t/, "\t").replace(/^\\t/, "\t");

        tableText = '';
        for (rowi = 0; rowi < sortedData.length; rowi++) {
            rowValues = [];
            for (coli = 0; coli < dataCache.fields.length; coli++) {
                if (dataCache.fieldDateFormat[coli] != null) { // Date
                    if (dateFormattingStrings[coli] === undefined) {
                        dateFormattingStrings[coli] =
                            document.getElementById('data-format-string-' + coli).value;
                    }
                    rowValues[coli] = wpd.dateConverter.formatDateNumber(
                        sortedData[rowi][coli], dateFormattingStrings[coli]);
                } else { // Non-date values
                    if (typeof sortedData[rowi][coli] === 'string') {
                        rowValues[coli] = sortedData[rowi][coli];
                    } else {
                        if (numFormattingStyle === 'fixed' && numFormattingDigits >= 0) {
                            rowValues[coli] = sortedData[rowi][coli].toFixed(numFormattingDigits);
                        } else if (numFormattingStyle === 'precision' && numFormattingDigits >= 0) {
                            rowValues[coli] =
                                sortedData[rowi][coli].toPrecision(numFormattingDigits);
                        } else if (numFormattingStyle === 'exponential' &&
                            numFormattingDigits >= 0) {
                            rowValues[coli] =
                                sortedData[rowi][coli].toExponential(numFormattingDigits);
                        } else {
                            rowValues[coli] = sortedData[rowi][coli];
                        }
                    }
                    if (rowValues[coli] === null) {
                        rowValues[coli] = '';
                    } else {
                        rowValues[coli] = rowValues[coli].toString().replace('.', decSeparator);
                    }
                }
            }
            tableText += rowValues.join(colSeparator);
            tableText += '\n';
        }
        $digitizedDataTable.value = tableText;
    }

    function copyToClipboard() {
        var $digitizedDataTable = document.getElementById('digitizedDataTable');
        $digitizedDataTable.focus();
        $digitizedDataTable.select();
        try {
            document.execCommand('copy');
        } catch (ex) {
            console.log('copyToClipboard', ex.message);
        }
    }

    function generateCSV() {
        var datasetName =
            selectedDataset != null ?
            selectedDataset.name :
            ((selectedMeasurement instanceof wpd.AngleMeasurement) ? "angles" : "distances");
        wpd.download.csv(tableText, datasetName + ".csv");
    }

    function exportToPlotly() {
        if (sortedData == null) {
            return;
        }
        var plotlyData = {
                "data": []
            },
            rowi, coli, fieldName;

        plotlyData.data[0] = {};

        for (rowi = 0; rowi < sortedData.length; rowi++) {
            for (coli = 0; coli < dataCache.fields.length; coli++) {

                fieldName = dataCache.fields[coli];
                // Replace first two to keep plotly happy:
                if (coli === 0) {
                    fieldName = 'x';
                } else if (coli === 1) {
                    fieldName = 'y';
                }

                if (rowi === 0) {
                    plotlyData.data[0][fieldName] = [];
                }

                if (dataCache.fieldDateFormat[coli] != null) {
                    plotlyData.data[0][fieldName][rowi] = wpd.dateConverter.formatDateNumber(
                        sortedData[rowi][coli], 'yyyy-mm-dd hh:ii:ss');
                } else {
                    plotlyData.data[0][fieldName][rowi] = sortedData[rowi][coli];
                }
            }
        }

        wpd.plotly.send(plotlyData);
    }

    return {
        showTable: showPlotData,
        showAngleData: showAngleData,
        showAreaData: showAreaData,
        showDistanceData: showDistanceData,
        updateSortingControls: updateSortingControls,
        reSort: reSort,
        copyToClipboard: copyToClipboard,
        generateCSV: generateCSV,
        exportToPlotly: exportToPlotly,
        changeDataset: changeDataset
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

/* Multi-layered canvas widget to display plot, data, graphics etc. */
var wpd = wpd || {};
wpd.graphicsWidget = (function() {
    var $mainCanvas, // original picture is displayed here
        $dataCanvas, // data points
        $drawCanvas, // selection region graphics etc
        $hoverCanvas, // temp graphics while drawing
        $topCanvas, // top level, handles mouse events

        $oriImageCanvas, $oriDataCanvas, $tempImageCanvas,

        $canvasDiv,

        mainCtx, dataCtx, drawCtx, hoverCtx, topCtx,

        oriImageCtx, oriDataCtx, tempImageCtx,

        width, height, originalWidth, originalHeight,

        aspectRatio, displayAspectRatio,

        originalImageData, scaledImage, zoomRatio, extendedCrosshair = false,
        hoverTimer,

        activeTool, repaintHandler,

        isCanvasInFocus = false,

        firstLoad = true;

    function posn(ev) { // get screen pixel from event
        let mainCanvasPosition = $mainCanvas.getBoundingClientRect();
        return {
            x: parseInt(ev.pageX - (mainCanvasPosition.left + window.pageXOffset), 10),
            y: parseInt(ev.pageY - (mainCanvasPosition.top + window.pageYOffset), 10)
        };
    }

    // get image pixel when screen pixel is provided
    function imagePx(screenX, screenY) {
        return {
            x: screenX / zoomRatio,
            y: screenY / zoomRatio
        };
    }

    // get screen pixel when image pixel is provided
    function screenPx(imageX, imageY) {
        return {
            x: imageX * zoomRatio,
            y: imageY * zoomRatio
        };
    }

    function getDisplaySize() {
        return {
            width: width,
            height: height
        };
    }

    function getImageSize() {
        return {
            width: originalWidth,
            height: originalHeight
        };
    }

    function getAllContexts() {
        return {
            mainCtx: mainCtx,
            dataCtx: dataCtx,
            drawCtx: drawCtx,
            hoverCtx: hoverCtx,
            topCtx: topCtx,
            oriImageCtx: oriImageCtx,
            oriDataCtx: oriDataCtx
        };
    }

    function resize(cwidth, cheight) {

        cwidth = parseInt(cwidth, 10);
        cheight = parseInt(cheight, 10);

        $canvasDiv.style.width = cwidth + 'px';
        $canvasDiv.style.height = cheight + 'px';

        $mainCanvas.width = cwidth;
        $dataCanvas.width = cwidth;
        $drawCanvas.width = cwidth;
        $hoverCanvas.width = cwidth;
        $topCanvas.width = cwidth;

        $mainCanvas.height = cheight;
        $dataCanvas.height = cheight;
        $drawCanvas.height = cheight;
        $hoverCanvas.height = cheight;
        $topCanvas.height = cheight;

        displayAspectRatio = cwidth / (cheight * 1.0);

        width = cwidth;
        height = cheight;

        drawImage();
    }

    function resetAllLayers() {
        $mainCanvas.width = $mainCanvas.width;
        resetDrawingLayers();
    }

    function resetDrawingLayers() {
        $dataCanvas.width = $dataCanvas.width;
        $drawCanvas.width = $drawCanvas.width;
        $hoverCanvas.width = $hoverCanvas.width;
        $topCanvas.width = $topCanvas.width;
        $oriDataCanvas.width = $oriDataCanvas.width;
    }

    function drawImage() {
        if (originalImageData == null)
            return;

        mainCtx.fillStyle = "rgb(255, 255, 255)";
        mainCtx.fillRect(0, 0, width, height);
        mainCtx.drawImage($oriImageCanvas, 0, 0, width, height);

        if (repaintHandler != null && repaintHandler.onRedraw != undefined) {
            repaintHandler.onRedraw();
        }

        if (activeTool != null && activeTool.onRedraw != undefined) {
            activeTool.onRedraw();
        }
    }

    function forceHandlerRepaint() {
        if (repaintHandler != null && repaintHandler.onForcedRedraw != undefined) {
            repaintHandler.onForcedRedraw();
        }
    }

    function setRepainter(fhandle) {
        if (repaintHandler != null && repaintHandler.onRemove != undefined) {
            repaintHandler.onRemove();
        }
        repaintHandler = fhandle;
        if (repaintHandler != null && repaintHandler.onAttach != undefined) {
            repaintHandler.onAttach();
        }
    }

    function getRepainter() {
        return repaintHandler;
    }

    function removeRepainter() {
        if (repaintHandler != null && repaintHandler.onRemove != undefined) {
            repaintHandler.onRemove();
        }
        repaintHandler = null;
    }

    function copyImageDataLayerToScreen() {
        dataCtx.drawImage($oriDataCanvas, 0, 0, width, height);
    }

    function zoomIn() {
        setZoomRatio(zoomRatio * 1.2);
    }

    function zoomOut() {
        setZoomRatio(zoomRatio / 1.2);
    }

    function zoomFit() {
        let viewportSize = wpd.layoutManager.getGraphicsViewportSize();
        let newAspectRatio = viewportSize.width / (viewportSize.height * 1.0);

        if (newAspectRatio > aspectRatio) {
            zoomRatio = viewportSize.height / (originalHeight * 1.0);
            resize(viewportSize.height * aspectRatio, viewportSize.height);
        } else {
            zoomRatio = viewportSize.width / (originalWidth * 1.0);
            resize(viewportSize.width, viewportSize.width / aspectRatio);
        }
    }

    function zoom100perc() {
        setZoomRatio(1.0);
    }

    function setZoomRatio(zratio) {
        zoomRatio = zratio;
        resize(originalWidth * zoomRatio, originalHeight * zoomRatio);
    }

    function getZoomRatio() {
        return zoomRatio;
    }

    function resetData() {
        $oriDataCanvas.width = $oriDataCanvas.width;
        $dataCanvas.width = $dataCanvas.width;
    }

    function resetHover() {
        $hoverCanvas.width = $hoverCanvas.width;
    }

    function toggleExtendedCrosshair(ev) { // called when backslash is hit
        if (ev.keyCode === 220) {
            ev.preventDefault();
            toggleExtendedCrosshairBtn();
        }
    }

    function toggleExtendedCrosshairBtn() { // called directly when toolbar button is hit
        extendedCrosshair = !(extendedCrosshair);
        let $crosshairBtn = document.getElementById('extended-crosshair-btn');
        if (extendedCrosshair) {
            $crosshairBtn.classList.add('pressed-button');
        } else {
            $crosshairBtn.classList.remove('pressed-button');
        }
        $topCanvas.width = $topCanvas.width;
    }

    function hoverOverCanvas(ev) {
        let pos = posn(ev);
        let xpos = pos.x;
        let ypos = pos.y;
        let imagePos = imagePx(xpos, ypos);

        if (extendedCrosshair) {
            $topCanvas.width = $topCanvas.width;
            topCtx.strokeStyle = "rgba(0,0,0, 0.5)";
            topCtx.beginPath();
            topCtx.moveTo(xpos, 0);
            topCtx.lineTo(xpos, height);
            topCtx.moveTo(0, ypos);
            topCtx.lineTo(width, ypos);
            topCtx.stroke();
        }

        setZoomImage(imagePos.x, imagePos.y);
        wpd.zoomView.setCoords(imagePos.x, imagePos.y);
    }

    function setZoomImage(ix, iy) {
        var zsize = wpd.zoomView.getSize(),
            zratio = wpd.zoomView.getZoomRatio(),
            ix0, iy0, iw, ih,
            idata, ddata, ixmin, iymin, ixmax, iymax, zxmin = 0,
            zymin = 0,
            zxmax = zsize.width,
            zymax = zsize.height,
            xcorr, ycorr, alpha;

        iw = zsize.width / zratio;
        ih = zsize.height / zratio;

        ix0 = ix - iw / 2.0;
        iy0 = iy - ih / 2.0;

        ixmin = ix0;
        iymin = iy0;
        ixmax = ix0 + iw;
        iymax = iy0 + ih;

        if (ix0 < 0) {
            ixmin = 0;
            zxmin = -ix0 * zratio;
        }
        if (iy0 < 0) {
            iymin = 0;
            zymin = -iy0 * zratio;
        }
        if (ix0 + iw >= originalWidth) {
            ixmax = originalWidth;
            zxmax = zxmax - zratio * (originalWidth - (ix0 + iw));
        }
        if (iy0 + ih >= originalHeight) {
            iymax = originalHeight;
            zymax = zymax - zratio * (originalHeight - (iy0 + ih));
        }
        idata = oriImageCtx.getImageData(parseInt(ixmin, 10), parseInt(iymin, 10),
            parseInt(ixmax - ixmin, 10), parseInt(iymax - iymin, 10));

        ddata = oriDataCtx.getImageData(parseInt(ixmin, 10), parseInt(iymin, 10),
            parseInt(ixmax - ixmin, 10), parseInt(iymax - iymin, 10));

        for (var index = 0; index < ddata.data.length; index += 4) {
            if (ddata.data[index] != 0 || ddata.data[index + 1] != 0 ||
                ddata.data[index + 2] != 0) {
                alpha = ddata.data[index + 3] / 255;
                idata.data[index] = (1 - alpha) * idata.data[index] + alpha * ddata.data[index];
                idata.data[index + 1] =
                    (1 - alpha) * idata.data[index + 1] + alpha * ddata.data[index + 1];
                idata.data[index + 2] =
                    (1 - alpha) * idata.data[index + 2] + alpha * ddata.data[index + 2];
            }
        }

        // Make this accurate to subpixel level
        xcorr = zratio * (parseInt(ixmin, 10) - ixmin);
        ycorr = zratio * (parseInt(iymin, 10) - iymin);

        wpd.zoomView.setZoomImage(idata, parseInt(zxmin + xcorr, 10), parseInt(zymin + ycorr, 10),
            parseInt(zxmax - zxmin, 10), parseInt(zymax - zymin, 10));
    }

    function updateZoomOnEvent(ev) {
        var pos = posn(ev),
            xpos = pos.x,
            ypos = pos.y,
            imagePos = imagePx(xpos, ypos);
        setZoomImage(imagePos.x, imagePos.y);
        wpd.zoomView.setCoords(imagePos.x, imagePos.y);
    }

    function updateZoomToImagePosn(x, y) {
        setZoomImage(x, y);
        wpd.zoomView.setCoords(x, y);
    }

    function hoverOverCanvasHandler(ev) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(hoverOverCanvas(ev), 10);
    }

    function dropHandler(ev) {
        wpd.busyNote.show();
        let allDrop = ev.dataTransfer.files;
        if (allDrop.length === 1) {
            wpd.imageManager.initializeFileManager(allDrop);
            wpd.imageManager.loadFromFile(allDrop[0]);
        }
    }

    function pasteHandler(ev) {
        if (ev.clipboardData !== undefined) {
            let items = ev.clipboardData.items;
            if (items !== undefined) {
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf("image") !== -1) {
                        wpd.busyNote.show();
                        var imageFile = items[i].getAsFile();
                        wpd.imageManager.initializeFileManager([imageFile]);
                        wpd.imageManager.loadFromFile(imageFile);
                    }
                }
            }
        }
    }

    function init() {
        $mainCanvas = document.getElementById('mainCanvas');
        $dataCanvas = document.getElementById('dataCanvas');
        $drawCanvas = document.getElementById('drawCanvas');
        $hoverCanvas = document.getElementById('hoverCanvas');
        $topCanvas = document.getElementById('topCanvas');

        $oriImageCanvas = document.createElement('canvas');
        $oriDataCanvas = document.createElement('canvas');
        $tempImageCanvas = document.createElement('canvas');

        mainCtx = $mainCanvas.getContext('2d');
        dataCtx = $dataCanvas.getContext('2d');
        hoverCtx = $hoverCanvas.getContext('2d');
        topCtx = $topCanvas.getContext('2d');
        drawCtx = $drawCanvas.getContext('2d');

        oriImageCtx = $oriImageCanvas.getContext('2d');
        oriDataCtx = $oriDataCanvas.getContext('2d');
        tempImageCtx = $tempImageCanvas.getContext('2d');

        $canvasDiv = document.getElementById('canvasDiv');

        // Extended crosshair
        document.addEventListener('keydown', function(ev) {
            if (isCanvasInFocus) {
                toggleExtendedCrosshair(ev);
            }
        }, false);

        // hovering over canvas
        $topCanvas.addEventListener('mousemove', hoverOverCanvasHandler, false);

        // drag over canvas
        $topCanvas.addEventListener('dragover', function(evt) {
            evt.preventDefault();
        }, true);
        $topCanvas.addEventListener("drop", function(evt) {
            evt.preventDefault();
            dropHandler(evt);
        }, true);

        $topCanvas.addEventListener("mousemove", onMouseMove, false);
        $topCanvas.addEventListener("click", onMouseClick, false);
        $topCanvas.addEventListener("mouseup", onMouseUp, false);
        $topCanvas.addEventListener("mousedown", onMouseDown, false);
        $topCanvas.addEventListener("mouseout", onMouseOut, true);
        document.addEventListener("mouseup", onDocumentMouseUp, false);

        document.addEventListener("mousedown", function(ev) {
            if (ev.target === $topCanvas) {
                isCanvasInFocus = true;
            } else {
                isCanvasInFocus = false;
            }
        }, false);
        document.addEventListener("keydown", function(ev) {
            if (isCanvasInFocus) {
                onKeyDown(ev);
            }
        }, true);

        wpd.zoomView.initZoom();

        // Paste image from clipboard
        window.addEventListener('paste', function(event) {
            pasteHandler(event);
        }, false);
    }

    function loadImage(originalImage) {
        if ($mainCanvas == null) {
            init();
        }
        removeTool();
        removeRepainter();
        originalWidth = originalImage.width;
        originalHeight = originalImage.height;
        aspectRatio = originalWidth / (originalHeight * 1.0);
        $oriImageCanvas.width = originalWidth;
        $oriImageCanvas.height = originalHeight;
        $oriDataCanvas.width = originalWidth;
        $oriDataCanvas.height = originalHeight;
        oriImageCtx.drawImage(originalImage, 0, 0, originalWidth, originalHeight);
        originalImageData = oriImageCtx.getImageData(0, 0, originalWidth, originalHeight);
        resetAllLayers();
        zoomFit();
        return originalImageData;
    }

    function loadImageFromData(idata, iwidth, iheight, keepZoom) {
        removeTool();
        removeRepainter();
        originalWidth = iwidth;
        originalHeight = iheight;
        aspectRatio = originalWidth / (originalHeight * 1.0);
        $oriImageCanvas.width = originalWidth;
        $oriImageCanvas.height = originalHeight;
        $oriDataCanvas.width = originalWidth;
        $oriDataCanvas.height = originalHeight;
        oriImageCtx.putImageData(idata, 0, 0);
        originalImageData = idata;
        resetAllLayers();

        if (!keepZoom) {
            zoomFit();
        } else {
            setZoomRatio(zoomRatio);
        }
    }

    function saveImage() {
        var exportCanvas = document.createElement('canvas'),
            exportCtx = exportCanvas.getContext('2d'),
            exportData, di, dLayer, alpha;
        exportCanvas.width = originalWidth;
        exportCanvas.height = originalHeight;
        exportCtx.drawImage($oriImageCanvas, 0, 0, originalWidth, originalHeight);
        exportData = exportCtx.getImageData(0, 0, originalWidth, originalHeight);
        dLayer = oriDataCtx.getImageData(0, 0, originalWidth, originalHeight);
        for (di = 0; di < exportData.data.length; di += 4) {
            if (dLayer.data[di] != 0 || dLayer.data[di + 1] != 0 || dLayer.data[di + 2] != 0) {
                alpha = dLayer.data[di + 3] / 255;
                exportData.data[di] = (1 - alpha) * exportData.data[di] + alpha * dLayer.data[di];
                exportData.data[di + 1] =
                    (1 - alpha) * exportData.data[di + 1] + alpha * dLayer.data[di + 1];
                exportData.data[di + 2] =
                    (1 - alpha) * exportData.data[di + 2] + alpha * dLayer.data[di + 2];
            }
        }
        exportCtx.putImageData(exportData, 0, 0);
        window.open(exportCanvas.toDataURL(), "_blank");
    }

    // run an external operation on the image data. this would normally mean a reset.
    function runImageOp(operFn) {
        let opResult = operFn(originalImageData, originalWidth, originalHeight);
        loadImageFromData(opResult.imageData, opResult.width, opResult.height, opResult.keepZoom);
    }

    function getImageData() {
        return originalImageData;
    }

    function setTool(tool) {
        if (activeTool != null && activeTool.onRemove != undefined) {
            activeTool.onRemove();
        }
        activeTool = tool;
        if (activeTool != null && activeTool.onAttach != undefined) {
            activeTool.onAttach();
        }
    }

    function removeTool() {
        if (activeTool != null && activeTool.onRemove != undefined) {
            activeTool.onRemove();
        }
        activeTool = null;
    }

    function onMouseMove(ev) {
        if (activeTool != null && activeTool.onMouseMove != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onMouseMove(ev, pos, imagePos);
        }
    }

    function onMouseClick(ev) {
        if (activeTool != null && activeTool.onMouseClick != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onMouseClick(ev, pos, imagePos);
        }
    }

    function onDocumentMouseUp(ev) {
        if (activeTool != null && activeTool.onDocumentMouseUp != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onDocumentMouseUp(ev, pos, imagePos);
        }
    }

    function onMouseUp(ev) {
        if (activeTool != null && activeTool.onMouseUp != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onMouseUp(ev, pos, imagePos);
        }
    }

    function onMouseDown(ev) {
        if (activeTool != null && activeTool.onMouseDown != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onMouseDown(ev, pos, imagePos);
        }
    }

    function onMouseOut(ev) {
        if (activeTool != null && activeTool.onMouseOut != undefined) {
            var pos = posn(ev),
                xpos = pos.x,
                ypos = pos.y,
                imagePos = imagePx(xpos, ypos);
            activeTool.onMouseOut(ev, pos, imagePos);
        }
    }

    function onKeyDown(ev) {
        if (activeTool != null && activeTool.onKeyDown != undefined) {
            activeTool.onKeyDown(ev);
        }
    }

    // for use when downloading wpd project file
    // converts all images (except pdfs) to png
    function getImageFiles() {
        let imageFiles = [];
        for (const file of wpd.appData.getFileManager().getFiles()) {
            let imageFile;
            if (file.type === 'application/pdf') {
                imageFile = file;
            } else {
                imageFile = _convertToPNG(file);
            }
            imageFiles.push(imageFile);
        }
        return Promise.all(imageFiles);
    }

    function _convertToPNG(imageFile) {
        return new Promise((resolve, reject) => {
            // reject any non-image files
            if (imageFile.type.match("image.*")) {
                let reader = new FileReader();
                reader.onload = function() {
                    let url = reader.result;
                    new Promise((resolve, reject) => {
                        let image = new Image();
                        image.onload = function() {
                            $tempImageCanvas.width = image.width;
                            $tempImageCanvas.height = image.height;
                            tempImageCtx.drawImage(image, 0, 0, image.width, image.height);
                            resolve();
                        };
                        image.src = url;
                    }).then(() => {
                        let imageURL = $tempImageCanvas.toDataURL('image/png');
                        let bstr = atob(imageURL.split(',')[1]);
                        let n = bstr.length;
                        let u8arr = new Uint8Array(n);
                        while (n--) {
                            u8arr[n] = bstr.charCodeAt(n);
                        }
                        resolve(new File([u8arr], imageFile.name, {
                            type: 'image/png',
                            encoding: 'utf-8',
                        }));
                        tempImageCtx.clearRect(0, 0, $tempImageCanvas.width, $tempImageCanvas.height);
                    });
                };
                reader.readAsDataURL(imageFile);
            } else {
                reject();
            }
        });
    }

    return {
        zoomIn: zoomIn,
        zoomOut: zoomOut,
        zoomFit: zoomFit,
        zoom100perc: zoom100perc,
        toggleExtendedCrosshairBtn: toggleExtendedCrosshairBtn,
        setZoomRatio: setZoomRatio,
        getZoomRatio: getZoomRatio,

        runImageOp: runImageOp,

        setTool: setTool,
        removeTool: removeTool,

        getAllContexts: getAllContexts,
        resetData: resetData,
        resetHover: resetHover,
        imagePx: imagePx,
        screenPx: screenPx,

        updateZoomOnEvent: updateZoomOnEvent,
        updateZoomToImagePosn: updateZoomToImagePosn,

        getDisplaySize: getDisplaySize,
        getImageSize: getImageSize,

        copyImageDataLayerToScreen: copyImageDataLayerToScreen,
        setRepainter: setRepainter,
        removeRepainter: removeRepainter,
        forceHandlerRepaint: forceHandlerRepaint,
        getRepainter: getRepainter,

        saveImage: saveImage,
        loadImage: loadImage,

        getImageFiles: getImageFiles
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

// layoutManager.js - manage layout of main sections on the screen.
var wpd = wpd || {};
wpd.layoutManager = (function() {
    var layoutTimer, $graphicsContainer, $sidebarContainer, $sidebarControlsContainer,
        $mainContainer, $treeContainer;

    // Redo layout when window is resized
    function adjustLayout() {
        let windowWidth = parseInt(document.body.offsetWidth, 10);
        let windowHeight = parseInt(document.body.offsetHeight, 10);

        $sidebarContainer.style.height = windowHeight + 'px';
        $sidebarControlsContainer.style.height = windowHeight - 280 + 'px';
        $mainContainer.style.width = windowWidth - $sidebarContainer.offsetWidth - 5 + 'px';
        $mainContainer.style.height = windowHeight + 'px';
        $graphicsContainer.style.height = windowHeight - 85 + 'px';
        $treeContainer.style.height = windowHeight - 85 + 'px';
        wpd.sidebar.resize();
    }

    function getGraphicsViewportSize() {
        return {
            width: $graphicsContainer.offsetWidth,
            height: $graphicsContainer.offsetHeight
        };
    }

    // event handler
    function adjustLayoutOnResize(ev) {
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(adjustLayout, 80);
    }

    // Set initial layout. Called right when the app is loaded.
    function initialLayout() {
        // do initial layout and also bind to the window resize event
        $graphicsContainer = document.getElementById('graphicsContainer');
        $sidebarContainer = document.getElementById('sidebarContainer');
        $sidebarControlsContainer = document.getElementById('sidebarControlsContainer');
        $mainContainer = document.getElementById('mainContainer');
        $treeContainer = document.getElementById('left-side-container');
        adjustLayout();

        window.addEventListener('resize', adjustLayoutOnResize, false);

        wpd.tree.init();
    }

    return {
        initialLayout: initialLayout,
        getGraphicsViewportSize: getGraphicsViewportSize
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.pointGroups = (function() {
    const settingsPopupID = "point-group-settings-popup";
    const deleteTuplePopupID = "point-tuple-delete-popup";

    const tableSelector = "#point-group-table";
    const controlsSelector = "#point-groups-controls";
    const displayGroupSelector = "#current-point-group-name";
    const displayTupleSelector = "#current-point-tuple-index";
    const defaultGroupSelector = "#point-group-0";
    const editPointGroupsButtonSelector = "#dataset-edit-point-groups-button";

    let deletedGroupIndexes = [];
    let currentTupleIndex = null;
    let currentGroupIndex = 0;

    let datasetSelectHandler = null;
    window.onload = () => {
        // attach listener on dataset select
        datasetSelectHandler = wpd.events.addListener("wpd.dataset.select", payload => {
            // hide edit point groups button if dataset is associated with a map axes
            const $editPointGroupsButton = document.querySelector(editPointGroupsButtonSelector);
            if (wpd.appData.getPlotData().getAxesForDataset(payload.dataset).name === "Map") {
                $editPointGroupsButton.hidden = true;
            } else {
                $editPointGroupsButton.hidden = false;
            }
        });
    };

    function showSettingsPopup() {
        // populate UI with existing point groups
        const dataset = wpd.tree.getActiveDataset();
        const pointGroups = dataset.getPointGroups();
        pointGroups.forEach((name, index) => {
            if (index > 0) {
                // add a row for each except default group
                wpd.pointGroups.addSettingsRow(false, name);
            } else {
                // set input value on default group
                document.querySelector(defaultGroupSelector).value = name;
            }
        });

        wpd.popup.show(settingsPopupID);
    }

    function closeSettingsPopup() {
        wpd.popup.close(settingsPopupID);

        // reset UI
        const $rows = document.querySelector(tableSelector).children;
        // spread the htmlCollection to an array to iterate
        [...$rows].forEach($row => {
            // note: the htmlCollection is live, therefore rowIndex will
            // update on each remove() call
            if ($row.rowIndex > 0) {
                // remove the rest
                $row.remove();
            } else {
                // clear input on default group
                document.querySelector(defaultGroupSelector).value = "";
            }
        });

        // clear deleted indexes
        deletedGroupIndexes = [];
    }

    function showDeleteTuplePopup(yesCallback, noCallback) {
        wpd.okCancelPopup.show(
            wpd.gettext("tuple-delete-title"), wpd.gettext("tuple-delete-text"),
            yesCallback, noCallback,
            wpd.gettext("yes"), wpd.gettext("no")
        );
    }

    function showDeleteGroupPopup(yesCallback, noCallback) {
        wpd.okCancelPopup.show(
            wpd.gettext("group-delete-title"), wpd.gettext("group-delete-text"),
            yesCallback, noCallback,
            wpd.gettext("yes"), wpd.gettext("no")
        );
    }

    function _getRowHTML(index, name) {
        const value = name || "";
        const groupText = wpd.gettext("point-group-group");
        const deleteGroupText = wpd.gettext("point-group-delete-group");

        // html templates
        const labelHTML = `${groupText} <span>${index}</span>: `;
        const inputHTML = `<input id="point-group-${index}" type="text" value="${value}" />`;
        const actionsHTML = `<input type="button" value="${deleteGroupText}" onclick="wpd.pointGroups.deleteSettingsRow(this)" />`;

        return `<tr><td>${labelHTML}</td><td>${inputHTML}</td><td>${actionsHTML}</td></tr>`;
    }

    function addSettingsRow(focus, name) {
        const $table = document.querySelector(tableSelector);
        const nextIndex = $table.lastElementChild.rowIndex + 1;

        // create new input "row"
        const $template = document.createElement("template");
        $template.innerHTML = _getRowHTML(nextIndex, name);

        // append new row
        $table.appendChild($template.content.firstChild);

        // focus on new input
        if (focus) {
            document.querySelector(`#point-group-${nextIndex}`).focus();
        }
    }

    function deleteSettingsRow($el) {
        const $targetRow = $el.closest("tr");

        deletedGroupIndexes.push($targetRow.rowIndex);

        // delete the target row
        $targetRow.remove();

        // re-index all rows
        const $rows = document.querySelector(tableSelector).children;
        // spread the htmlCollection to an array to iterate
        [...$rows].forEach($row => {
            const $cells = $row.children;
            const index = $row.rowIndex;

            $cells[0].querySelector("span").innerText = index;
            $cells[1].querySelector("input").setAttribute("id", `point-group-${index}`);
        });
    }

    function saveSettings() {
        if (deletedGroupIndexes.length > 0) {
            wpd.pointGroups.showDeleteGroupPopup(
                _saveSettings.bind(null, true),
                _saveSettings.bind(null, false)
            );
        } else {
            _saveSettings();
        }
    }

    function _saveSettings(deletePoints) {
        // get existing point groups
        const dataset = wpd.tree.getActiveDataset();
        const pointGroups = dataset.getPointGroups();

        // get new point groups
        const $rows = document.querySelector(tableSelector).children;
        // spread the htmlCollection to an array to iterate
        let newPointGroups = [...$rows].map($row => {
            return $row.querySelector(`#point-group-${$row.rowIndex}`).value;
        });

        // only primary group collected, check for custom name
        if (newPointGroups.length === 1) {
            // no custom name, empty out array
            if (!newPointGroups[0]) {
                newPointGroups = [];
            }

            // hide point group controls
            wpd.pointGroups.hideControls();
        } else if (newPointGroups.length > 1) {
            // display point group controls
            wpd.pointGroups.showControls();
        }

        // handle deleted groups in tuples
        if (deletedGroupIndexes.length > 0) {
            const axes = wpd.tree.getActiveAxes();

            // sort delete group indexes in descending order
            deletedGroupIndexes.sort((a, b) => b - a).forEach(groupIndex => {
                if (deletePoints) {
                    // find all pixel indexes in the group
                    const pixelIndexes = dataset.getPixelIndexesInGroup(groupIndex).sort((a, b) => b - a);

                    // remove all pixels
                    pixelIndexes.forEach(pixelIndex => {
                        if (pixelIndex !== null) {
                            dataset.removePixelAtIndex(pixelIndex);
                            dataset.refreshTuplesAfterPixelRemoval(pixelIndex);
                        }
                    });

                    // refresh UI
                    wpd.graphicsWidget.resetData();
                    wpd.graphicsWidget.forceHandlerRepaint();
                    wpd.dataPointCounter.setCount(dataset.getCount());

                    // dispatch point delete event
                    pixelIndexes.forEach(pixelIndex => {
                        wpd.events.dispatch("wpd.dataset.point.delete", {
                            axes: axes,
                            dataset: dataset,
                            index: pixelIndex
                        });
                    });
                }

                // remove the group from the tuples
                dataset.removePointGroupFromTuples(groupIndex);
            });
        }

        // handle added groups in tuples
        const addedCount = newPointGroups.length + deletedGroupIndexes.length - pointGroups.length;
        if (addedCount > 0) {
            dataset.refreshTuplesAfterGroupAdd(addedCount);
        }

        // set new point group
        dataset.setPointGroups(newPointGroups);

        // clear indexes if settings have just been added
        if (pointGroups.length === 0) {
            currentTupleIndex = null;
            currentGroupIndex = 0;
        }

        // refresh control display
        wpd.pointGroups.refreshControls();

        // close popup
        wpd.pointGroups.closeSettingsPopup();
    }

    function showControls() {
        document.querySelector(controlsSelector).hidden = false;
    }

    function hideControls() {
        document.querySelector(controlsSelector).hidden = true;
    }

    function refreshControls() {
        let name = wpd.tree.getActiveDataset().getPointGroups()[currentGroupIndex];

        if (!name) {
            name = currentGroupIndex === 0 ?
                wpd.gettext("point-group-primary-group") :
                `${wpd.gettext("point-group-group")} ${currentGroupIndex}`;
        }

        let tuple = currentTupleIndex;
        if (currentTupleIndex === null) {
            tuple = `(${wpd.gettext("point-group-new-tuple")})`
        }

        document.querySelector(displayGroupSelector).innerText = name;
        document.querySelector(displayTupleSelector).innerText = tuple;
    }

    function previousGroup() {
        const dataset = wpd.tree.getActiveDataset();

        // do nothing if already at the first group of the first tuple
        if (currentTupleIndex !== 0 || currentGroupIndex !== 0) {
            let previousTupleIndex = -1;
            let previousGroupIndex = -1;

            const tuples = dataset.getAllTuples();
            const startTupleIndex = currentTupleIndex === null ? tuples.length - 1 : currentTupleIndex;
            for (let tupleIndex = startTupleIndex; tupleIndex >= 0; tupleIndex--) {
                const tuple = tuples[tupleIndex];

                // if tuple is ever undefined, assume it has been deleted
                // set pointer to new entry
                if (tuple === undefined) {
                    previousTupleIndex = null;
                    previousGroupIndex = 0;
                    break;
                }

                // start group index search at the end
                let startGroupIndex = tuple.length - 1;
                if (tupleIndex === currentTupleIndex) {
                    // at where tuple search began, exclude current group index
                    startGroupIndex = currentGroupIndex - 1;
                }

                // if start group index is negative, skip to the previous tuple
                if (startGroupIndex > -1) {
                    const groupIndex = tuple.lastIndexOf(null, startGroupIndex);

                    if (groupIndex > -1) {
                        // tuple and group with empty slot identified
                        // set as current tuple and group
                        previousTupleIndex = tupleIndex;
                        previousGroupIndex = groupIndex;
                        break;
                    }
                }
            }

            // stay put if no open slot found
            if (previousTupleIndex !== -1 && previousGroupIndex !== -1) {
                currentTupleIndex = previousTupleIndex;
                currentGroupIndex = previousGroupIndex;
            }
        }

        wpd.pointGroups.refreshControls();
    }

    function nextGroup() {
        const dataset = wpd.tree.getActiveDataset();

        // do nothing if already at a new entry
        if (currentTupleIndex !== null) {
            let nextTupleIndex = -1;
            let nextGroupIndex = -1;

            const tuples = dataset.getAllTuples();
            for (let tupleIndex = currentTupleIndex; tupleIndex < tuples.length; tupleIndex++) {
                const tuple = tuples[tupleIndex];

                // exclude current tuple and group from search
                let startGroupIndex = 0;
                if (tupleIndex === currentTupleIndex) {
                    startGroupIndex = currentGroupIndex + 1;
                }

                const groupIndex = tuple.indexOf(null, startGroupIndex);

                if (groupIndex > -1) {
                    // tuple and group with empty slot identified
                    // set as current tuple and group
                    nextTupleIndex = tupleIndex;
                    nextGroupIndex = groupIndex;
                    break;
                }
            }

            if (nextTupleIndex === -1 && nextGroupIndex === -1) {
                // no open slots, go to new tuple at first group
                currentTupleIndex = null;
                currentGroupIndex = 0;
            } else {
                // open slot found
                currentTupleIndex = nextTupleIndex;
                currentGroupIndex = nextGroupIndex;
            }
        }

        wpd.pointGroups.refreshControls();
    }

    function getCurrentGroupIndex() {
        return currentGroupIndex;
    }

    function setCurrentGroupIndex(groupIndex) {
        currentGroupIndex = groupIndex;
    }

    function getCurrentTupleIndex() {
        return currentTupleIndex;
    }

    function setCurrentTupleIndex(tupleIndex) {
        currentTupleIndex = tupleIndex;
    }

    return {
        showSettingsPopup: showSettingsPopup,
        closeSettingsPopup: closeSettingsPopup,
        addSettingsRow: addSettingsRow,
        deleteSettingsRow: deleteSettingsRow,
        saveSettings: saveSettings,
        previousGroup: previousGroup,
        nextGroup: nextGroup,
        getCurrentGroupIndex: getCurrentGroupIndex,
        setCurrentGroupIndex: setCurrentGroupIndex,
        getCurrentTupleIndex: getCurrentTupleIndex,
        setCurrentTupleIndex: setCurrentTupleIndex,
        showControls: showControls,
        hideControls: hideControls,
        refreshControls: refreshControls,
        showDeleteTuplePopup: showDeleteTuplePopup,
        showDeleteGroupPopup: showDeleteGroupPopup
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

// Handle popup windows
var wpd = wpd || {};
wpd.popup = (function() {
    let dragInfo = null;
    let $activeWindow = null;

    function show(popupid) {

        // Dim lights to make it obvious that these are modal dialog boxes.
        let shadowDiv = document.getElementById('shadow');
        shadowDiv.style.visibility = "visible";

        // Display the popup
        let pWindow = document.getElementById(popupid);
        let screenWidth = parseInt(window.innerWidth, 10);
        let screenHeight = parseInt(window.innerHeight, 10);
        let pWidth = parseInt(pWindow.offsetWidth, 10);
        let pHeight = parseInt(pWindow.offsetHeight, 10);
        let xPos = (screenWidth - pWidth) / 2;
        let yPos = (screenHeight - pHeight) / 2;
        yPos = yPos > 60 ? 60 : yPos;
        pWindow.style.left = xPos + 'px';
        pWindow.style.top = yPos + 'px';
        pWindow.style.visibility = "visible";

        // Attach drag events to the header
        for (let i = 0; i < pWindow.childNodes.length; i++) {
            if (pWindow.childNodes[i].className === 'popupheading') {
                pWindow.childNodes[i].addEventListener("mousedown", startDragging, false);
                break;
            }
        }

        window.addEventListener("keydown", handleKeydown, false);

        $activeWindow = pWindow;

        // set focus to first input field
        let inputs = pWindow.getElementsByTagName("input");
        if (inputs.length > 0) {
            inputs[0].focus();
        }
    }

    function close(popupid) {

        let shadowDiv = document.getElementById('shadow');
        shadowDiv.style.visibility = "hidden";

        let pWindow = document.getElementById(popupid);
        pWindow.style.visibility = "hidden";

        removeDragMask();

        window.removeEventListener("keydown", handleKeydown, false);
        $activeWindow = null;
    }

    function startDragging(ev) {
        // Create a drag mask that will react to mouse action after this point
        let $dragMask = document.createElement('div');
        $dragMask.className = 'popup-drag-mask';
        $dragMask.style.display = 'inline-block';
        $dragMask.addEventListener('mousemove', dragMouseMove, false);
        $dragMask.addEventListener('mouseup', dragMouseUp, false);
        $dragMask.addEventListener('mouseout', dragMouseOut, false);
        document.body.appendChild($dragMask);

        dragInfo = {
            dragMaskDiv: $dragMask,
            initialMouseX: ev.pageX,
            initialMouseY: ev.pageY,
            initialWindowX: $activeWindow.offsetLeft,
            initialWindowY: $activeWindow.offsetTop
        };

        ev.preventDefault();
        ev.stopPropagation();
    }

    function dragMouseMove(ev) {
        moveWindow(ev);
        ev.stopPropagation();
        ev.preventDefault();
    }

    function dragMouseUp(ev) {
        moveWindow(ev);
        removeDragMask();
        ev.stopPropagation();
        ev.preventDefault();
    }

    function moveWindow(ev) {
        let newWindowX = (dragInfo.initialWindowX + ev.pageX - dragInfo.initialMouseX);
        let newWindowY = (dragInfo.initialWindowY + ev.pageY - dragInfo.initialMouseY);
        let appWidth = parseInt(document.body.offsetWidth, 10);
        let appHeight = parseInt(document.body.offsetHeight, 10);
        let windowWidth = parseInt($activeWindow.offsetWidth, 10);
        let windowHeight = parseInt($activeWindow.offsetHeight, 10);

        // move only up to a reasonable bound:
        if (newWindowX + 0.7 * windowWidth < appWidth && newWindowX > 0 && newWindowY > 0 &&
            newWindowY + 0.5 * windowHeight < appHeight) {
            $activeWindow.style.top = newWindowY + 'px';
            $activeWindow.style.left = newWindowX + 'px';
        }
    }

    function dragMouseOut(ev) {
        removeDragMask();
    }

    function removeDragMask() {
        if (dragInfo != null && dragInfo.dragMaskDiv != null) {
            dragInfo.dragMaskDiv.removeEventListener('mouseout', dragMouseOut, false);
            dragInfo.dragMaskDiv.removeEventListener('mouseup', dragMouseUp, false);
            dragInfo.dragMaskDiv.removeEventListener('mousemove', dragMouseMove, false);
            dragInfo.dragMaskDiv.style.display = 'none';
            document.body.removeChild(dragInfo.dragMaskDiv);
            dragInfo = null;
        }
    }

    function handleKeydown(e) {
        if (wpd.keyCodes.isEsc(e.keyCode)) {
            close($activeWindow.id);
        }
    }

    return {
        show: show,
        close: close
    };
})();

wpd.busyNote = (function() {
    var noteDiv, isVisible = false;

    function show() {
        if (isVisible) {
            return;
        }
        if (noteDiv == null) {
            noteDiv = document.createElement('div');
            noteDiv.id = 'wait';
            noteDiv.innerHTML = '<p align="center">' + wpd.gettext('processing') + '...</p>';
        }
        document.body.appendChild(noteDiv);
        isVisible = true;
    }

    function close() {
        if (noteDiv != null && isVisible === true) {
            document.body.removeChild(noteDiv);
            isVisible = false;
        }
    }

    return {
        show: show,
        close: close
    };
})();

wpd.messagePopup = (function() {
    var close_callback;

    function show(title, msg, callback) {
        wpd.popup.show('messagePopup');
        document.getElementById('message-popup-heading').innerHTML = title;
        document.getElementById('message-popup-text').innerHTML = msg;
        close_callback = callback;
    }

    function close() {
        wpd.popup.close('messagePopup');
        if (close_callback != null) {
            close_callback();
        }
    }

    return {
        show: show,
        close: close
    };
})();

wpd.okCancelPopup = (function() {
    var okCallback, cancelCallback;

    function show(title, msg, ok_callback, cancel_callback, ok_text, cancel_text) {
        wpd.popup.show("okCancelPopup");
        document.getElementById("ok-cancel-popup-heading").innerHTML = title;
        document.getElementById("ok-cancel-popup-text").innerHTML = msg;
        document.getElementById("ok-cancel-popup-ok-button").value = ok_text || wpd.gettext("ok");
        document.getElementById("ok-cancel-popup-cancel-button").value = cancel_text || wpd.gettext("cancel");
        okCallback = ok_callback;
        cancelCallback = cancel_callback;
    }

    function ok() {
        wpd.popup.close("okCancelPopup");
        if (okCallback != null) {
            okCallback();
        }
    }

    function cancel() {
        wpd.popup.close("okCancelPopup");
        if (cancelCallback != null) {
            cancelCallback();
        }
    }

    return {
        show: show,
        ok: ok,
        cancel: cancel
    };
})();

wpd.unsupported = function() {
    wpd.messagePopup.show(wpd.gettext('unsupported'), wpd.gettext('unsupported-text'));
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};
wpd.sidebar = (function() {
    function show(sbid) { // Shows a specific sidebar
        clear();
        let sb = document.getElementById(sbid);
        sb.style.display = "inline-block";
        sb.style.height = parseInt(document.body.offsetHeight, 10) - 280 + 'px';
    }

    function clear() { // Clears all open sidebars

        const sidebarList = document.getElementsByClassName('sidebar');
        for (let ii = 0; ii < sidebarList.length; ii++) {
            sidebarList[ii].style.display = "none";
        }
    }

    function resize() {

        let sidebarList = document.getElementsByClassName('sidebar');
        for (let ii = 0; ii < sidebarList.length; ii++) {
            if (sidebarList[ii].style.display === "inline-block") {
                sidebarList[ii].style.height =
                    parseInt(document.body.offsetHeight, 10) - 280 + 'px';
            }
        }
    }

    return {
        show: show,
        clear: clear,
        resize: resize
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/
var wpd = wpd || {};
wpd.toolbar = (function() {
    function show(tbid) { // Shows a specific toolbar
        clear();
        let tb = document.getElementById(tbid);
        tb.style.visibility = "visible";
    }

    function clear() { // Clears all open toolbars

        const toolbarList = document.getElementsByClassName('toolbar');
        for (let ii = 0; ii < toolbarList.length; ii++) {
            toolbarList[ii].style.visibility = "hidden";
        }
    }

    return {
        show: show,
        clear: clear
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.*/

var wpd = wpd || {};

wpd.TreeWidget = class {
    constructor($elem) {
        this.$mainElem = $elem;
        this.treeData = null;
        this.itemColors = {};
        this.$mainElem.addEventListener("click", e => this._onclick(e));
        this.$mainElem.addEventListener("keydown", e => this._onkeydown(e));
        this.$mainElem.addEventListener("dblclick", e => this._ondblclick(e));
        this.idmap = [];
        this.itemCount = 0;
        this.selectedPath = null;
    }

    _renderFolder(data, basePath, isInnerFolder) {
        if (data == null)
            return;

        let htmlStr = "";

        if (isInnerFolder) {
            htmlStr = "<ul class=\"tree-list\">";
        } else {
            htmlStr = "<ul class=\"tree-list-root\">";
        }

        for (let i = 0; i < data.length; i++) {
            let item = data[i];
            this.itemCount++;
            if (typeof(item) === "string") {
                let itemPath = basePath + "/" + item;
                htmlStr += "<li title=\"" + item + "\">";
                let itemColor = this.itemColors[itemPath];
                if (typeof(itemColor) !== 'undefined') {
                    htmlStr += "<div class=\"tree-item-icon\" style=\"background-color: " + itemColor.toRGBString() + ";\"></div>";
                }
                htmlStr += "<span class=\"tree-item\" id=\"tree-item-id-" + this.itemCount + "\">" +
                    item + "</span>";
                this.idmap[this.itemCount] = itemPath;
            } else if (typeof(item) === "object") {
                htmlStr += "<li>";
                let labelKey = Object.keys(item)[0];
                htmlStr += "<span class=\"tree-folder\" id=\"tree-item-id-" + this.itemCount +
                    "\">" + labelKey + "</span>";
                this.idmap[this.itemCount] = basePath + "/" + labelKey;
                htmlStr += this._renderFolder(item[labelKey], basePath + "/" + labelKey, true);
            }
            htmlStr += "</li>";
        }
        htmlStr += "</ul>";
        return (htmlStr);
    }

    // Expected format:
    // treeData = ["item0", {"folder0": ["sub-item0", "sub-item1"]}, "item1"]
    // itemColors = {"path0" : wpd.Color, "path1" : wpd.Color}
    render(treeData, itemColors) {
        this.idmap = [];
        this.itemCount = 0;
        this.treeData = treeData;
        this.itemColors = itemColors;
        this.$mainElem.innerHTML = this._renderFolder(this.treeData, "", false);
        this.selectedPath = null;
    }

    _unselectAll() {
        const $folders = this.$mainElem.querySelectorAll(".tree-folder");
        const $items = this.$mainElem.querySelectorAll(".tree-item");
        $folders.forEach(function($e) {
            $e.classList.remove("tree-selected");
        });
        $items.forEach(function($e) {
            $e.classList.remove("tree-selected");
        });
        this.selectedPath = null;
    }

    selectPath(itemPath, suppressSecondaryActions) {
        const itemId = this.idmap.indexOf(itemPath);
        if (itemId >= 0) {
            this._unselectAll();
            this.selectedPath = itemPath;
            const $item = document.getElementById("tree-item-id-" + itemId);
            $item.classList.add("tree-selected");
            if (this.itemSelectionCallback != null) {
                this.itemSelectionCallback($item, itemPath, suppressSecondaryActions);
            }
        }
    }

    _onclick(e) {
        const isItem = e.target.classList.contains("tree-item");
        const isFolder = e.target.classList.contains("tree-folder");
        if (isItem || isFolder) {
            this._unselectAll();
            e.target.classList.add("tree-selected");
            if (this.itemSelectionCallback != null) {
                let itemId = parseInt(e.target.id.replace("tree-item-id-", ""), 10);
                if (!isNaN(itemId)) {
                    this.selectedPath = this.idmap[itemId];
                    this.itemSelectionCallback(e.target, this.idmap[itemId], false);
                }
            }
        }
    }

    _onkeydown(e) {
        // allow either F2 or Meta+R to trigger rename
        if (e.key === "F2" || (e.key.toLowerCase() === "r" && e.metaKey)) {
            if (this.itemRenameCallback) {
                this.itemRenameCallback(e.target, this.selectedPath, false);
                e.preventDefault();
            }
        }
    }

    _ondblclick(e) {
        if (this.itemRenameCallback) {
            this.itemRenameCallback(e.target, this.selectedPath, false);
            e.preventDefault();
            e.stopPropagation();
        }
    }

    onItemSelection(callback) {
        this.itemSelectionCallback = callback;
    }

    onItemRename(callback) {
        this.itemRenameCallback = callback;
    }

    getSelectedPath() {
        return this.selectedPath;
    }
};

wpd.tree = (function() {
    let treeWidget = null;
    let activeDataset = null;
    let activeAxes = null;

    // polyfill for IE11/Microsoft Edge
    if (window.NodeList && !NodeList.prototype.forEach) {
        NodeList.prototype.forEach = function(callback, thisArg) {
            thisArg = thisArg || window;
            for (let i = 0; i < this.length; i++) {
                callback.call(thisArg, this[i], i, this);
            }
        };
    }

    function buildTree() {
        if (treeWidget == null) {
            return;
        }
        let treeData = [];
        let itemColors = {};

        const plotData = wpd.appData.getPlotData();
        const fileManager = wpd.appData.getFileManager();
        const pageManager = wpd.appData.getPageManager();
        const currentFileIndex = fileManager.currentFileIndex();

        // Image item
        treeData.push(wpd.gettext('image'));

        // Axes folder
        let axesNames = plotData.getAxesNames();
        const axesFileMap = fileManager.getAxesNameMap();
        axesNames = axesNames.filter(name => axesFileMap[name] === currentFileIndex);
        let axesFolder = {};
        if (wpd.appData.isMultipage()) {
            const currentPage = pageManager.currentPage();
            const axesPageMap = pageManager.getAxesNameMap();
            axesFolder[wpd.gettext("axes")] = axesNames.filter(
                name => axesPageMap[name] === currentPage
            );
        } else {
            axesFolder[wpd.gettext("axes")] = axesNames;
        }
        treeData.push(axesFolder);

        // Datasets folder
        let datasetNames = plotData.getDatasetNames();
        const datasetFileMap = fileManager.getDatasetNameMap();
        datasetNames = datasetNames.filter(name => datasetFileMap[name] === currentFileIndex);
        let datasetsFolder = {};
        if (wpd.appData.isMultipage()) {
            const currentPage = pageManager.currentPage();
            const datasetPageMap = pageManager.getDatasetNameMap();
            datasetsFolder[wpd.gettext("datasets")] = datasetNames.filter(
                name => datasetPageMap[name] === currentPage
            );
        } else {
            datasetsFolder[wpd.gettext("datasets")] = datasetNames;
        }
        treeData.push(datasetsFolder);

        // Dataset colors
        for (let ds of plotData.getDatasets()) {
            if (ds.colorRGB != null) {
                itemColors["/" + wpd.gettext("datasets") + "/" + ds.name] = ds.colorRGB;
            }
        }

        // Measurements folder
        let distMeasures = fileManager.filterToCurrentFileMeasurements(
            plotData.getMeasurementsByType(wpd.DistanceMeasurement)
        );
        let angleMeasures = fileManager.filterToCurrentFileMeasurements(
            plotData.getMeasurementsByType(wpd.AngleMeasurement)
        );
        let areaMeasures = fileManager.filterToCurrentFileMeasurements(
            plotData.getMeasurementsByType(wpd.AreaMeasurement)
        );
        if (wpd.appData.isMultipage()) {
            distMeasures = pageManager.filterToCurrentPageMeasurements(distMeasures);
            angleMeasures = pageManager.filterToCurrentPageMeasurements(angleMeasures);
            areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
        }

        let measurementItems = [];
        if (areaMeasures.length > 0) {
            measurementItems.push(wpd.gettext("area"));
        }
        if (angleMeasures.length > 0) {
            measurementItems.push(wpd.gettext("angle"));
        }
        if (distMeasures.length > 0) {
            measurementItems.push(wpd.gettext("distance"));
        }
        let measurementFolder = {};
        measurementFolder[wpd.gettext("measurements")] = measurementItems;
        treeData.push(measurementFolder);

        treeWidget.render(treeData, itemColors);

        showTreeItemWidget(null);
    }

    function showTreeItemWidget(id) {
        const $treeWidgets = document.querySelectorAll(".tree-widget");
        $treeWidgets.forEach(function($e) {
            if ($e.id === id) {
                $e.style.display = "inline";
            } else {
                $e.style.display = "none";
            }
        });
    }

    function resetGraphics() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        wpd.sidebar.clear();
    }

    function onDatasetSelection(elem, path, suppressSecondaryActions) {
        // get dataset index
        const plotData = wpd.appData.getPlotData();
        const dsNamesColl = plotData.getDatasetNames();
        const dsIdx = dsNamesColl.indexOf(path.replace("/" + wpd.gettext("datasets") + "/", ""));
        if (dsIdx >= 0) {
            if (!suppressSecondaryActions) {
                // clean up existing UI
                resetGraphics();
            }

            activeDataset = plotData.getDatasets()[dsIdx];

            if (!suppressSecondaryActions) {
                // set up UI for the new dataset
                wpd.acquireData.load();
            }
        }
        showTreeItemWidget('dataset-item-tree-widget');
        renderDatasetAxesSelection();
        setDatasetDisplayColor();
        // dispatch dataset select event
        wpd.events.dispatch("wpd.dataset.select", {
            dataset: activeDataset
        });
    }

    function onDatasetGroupSelection() {
        resetGraphics();

        let axesList = [];
        let datasetList = [];

        const plotData = wpd.appData.getPlotData();
        const fileManager = wpd.appData.getFileManager();
        const datasetFileMap = fileManager.getDatasetNameMap();
        const currentFileIndex = fileManager.currentFileIndex();

        let datasets = plotData.getDatasets().filter(d => datasetFileMap[d.name] === currentFileIndex);

        if (wpd.appData.isMultipage()) {
            const pageManager = wpd.appData.getPageManager();
            const currentPage = pageManager.currentPage();
            const datasetPageMap = pageManager.getDatasetNameMap();
            for (let ds of datasets.filter(d => datasetPageMap[d.name] === currentPage)) {
                axesList.push(plotData.getAxesForDataset(ds));
                datasetList.push(ds);
            }
        } else {
            for (let ds of datasets) {
                axesList.push(plotData.getAxesForDataset(ds));
                datasetList.push(ds);
            }
        }
        wpd.graphicsWidget.setRepainter(new wpd.MultipltDatasetRepainter(axesList, datasetList));
    }

    function renderDatasetAxesSelection() {
        if (activeDataset == null)
            return;
        const plotData = wpd.appData.getPlotData();
        const axesNames = plotData.getAxesNames();
        const dsaxes = plotData.getAxesForDataset(activeDataset);
        const $selection = document.getElementById("dataset-item-axes-select");

        const fileManager = wpd.appData.getFileManager();
        const axesFileMap = fileManager.getAxesNameMap();
        const currentFileIndex = fileManager.currentFileIndex();
        let innerHTML = "<option value='-1'>None</option>";
        if (wpd.appData.isMultipage()) {
            const pageManager = wpd.appData.getPageManager();
            const currentPage = pageManager.currentPage();
            const axesPageMap = pageManager.getAxesNameMap();
            for (let axIdx = 0; axIdx < axesNames.length; axIdx++) {
                if (
                    axesFileMap[axesNames[axIdx]] === currentFileIndex &&
                    axesPageMap[axesNames[axIdx]] === currentPage
                ) {
                    innerHTML += "<option value='" + axIdx + "'>" + axesNames[axIdx] + "</option>";
                }
            }
        } else {
            for (let axIdx = 0; axIdx < axesNames.length; axIdx++) {
                if (axesFileMap[axesNames[axIdx]] === currentFileIndex) {
                    innerHTML += "<option value='" + axIdx + "'>" + axesNames[axIdx] + "</option>";
                }
            }
        }
        $selection.innerHTML = innerHTML;

        if (dsaxes == null) {
            $selection.value = "-1";
        } else {
            $selection.value = axesNames.indexOf(dsaxes.name);
        }
        activeAxes = dsaxes;
    }

    function setDatasetDisplayColor() {
        if (activeDataset == null) {
            return;
        }
        let $btn = document.getElementById("dataset-display-color-picker-button");
        $btn.style.backgroundColor = activeDataset.colorRGB.toRGBString();
    }

    function renderAreaAxesSelection() {
        renderAxesSelectionForMeasurement(wpd.measurementModes.area);
    }

    function renderDistanceAxesSelection() {
        renderAxesSelectionForMeasurement(wpd.measurementModes.distance);
    }

    function renderAxesSelectionForMeasurement(mode) {
        const plotData = wpd.appData.getPlotData();
        const axesColl = plotData.getAxesColl();
        const isDist = mode == wpd.measurementModes.distance;

        const fileManager = wpd.appData.getFileManager();
        const axesFileMap = fileManager.getAxesNameMap();
        const currentFileIndex = fileManager.currentFileIndex();

        let msColl = fileManager.filterToCurrentFileMeasurements(
            isDist ? plotData.getMeasurementsByType(wpd.DistanceMeasurement) :
            plotData.getMeasurementsByType(wpd.AreaMeasurement)
        );
        let ms;

        let innerHTML = "<option value='-1'>None</option>";
        if (wpd.appData.isMultipage()) {
            const pageManager = wpd.appData.getPageManager();
            const currentPage = pageManager.currentPage();
            const axesPageMap = pageManager.getAxesNameMap();

            msColl = pageManager.filterToCurrentPageMeasurements(msColl);
            ms = msColl[msColl.length - 1];

            for (let axIdx = 0; axIdx < axesColl.length; axIdx++) {
                if (
                    axesFileMap[axesColl[axIdx].name] === currentFileIndex &&
                    axesPageMap[axesColl[axIdx].name] === currentPage &&
                    (
                        axesColl[axIdx] instanceof wpd.ImageAxes ||
                        axesColl[axIdx] instanceof wpd.MapAxes
                    )
                ) {
                    innerHTML += "<option value='" + axIdx + "'>" + axesColl[axIdx].name + "</option>";
                }
            }
        } else {
            ms = msColl[0];

            for (let axIdx = 0; axIdx < axesColl.length; axIdx++) {
                if (
                    axesFileMap[axesColl[axIdx].name] === currentFileIndex &&
                    (
                        axesColl[axIdx] instanceof wpd.ImageAxes ||
                        axesColl[axIdx] instanceof wpd.MapAxes
                    )
                ) {
                    innerHTML += "<option value='" + axIdx + "'>" + axesColl[axIdx].name + "</option>";
                }
            }
        }

        const $selection = isDist ? document.getElementById("distance-item-axes-select") :
            document.getElementById("area-item-axes-select");
        $selection.innerHTML = innerHTML;

        const axes = plotData.getAxesForMeasurement(ms);
        if (axes == null) {
            $selection.value = "-1";
        } else {
            $selection.value = axesColl.indexOf(axes);
        }
        activeAxes = axes;
    }

    function onAxesSelection(elem, path, suppressSecondaryActions) {
        resetGraphics();
        showTreeItemWidget("axes-item-tree-widget");
        const axName = path.replace("/" + wpd.gettext("axes") + "/", "");
        const plotData = wpd.appData.getPlotData();
        const axIdx = plotData.getAxesNames().indexOf(axName);
        activeAxes = plotData.getAxesColl()[axIdx];
        const $tweakButton = document.getElementById("tweak-axes-calibration-button");
        $tweakButton.disabled = activeAxes instanceof wpd.ImageAxes ? true : false;
        // dispatch axes select event
        wpd.events.dispatch("wpd.axes.select", {
            axes: activeAxes
        });
    }

    function onImageSelection(elem, path, suppressSecondaryActions) {
        resetGraphics();
        activeAxes = null;
        showTreeItemWidget('image-item-tree-widget');
        wpd.sidebar.show('image-editing-sidebar');
        wpd.appData.getUndoManager().updateUI();
    }

    function onSelection(elem, path, suppressSecondaryActions) {
        if (path === '/' + wpd.gettext('image')) {
            onImageSelection(elem, path, suppressSecondaryActions);
        } else if (path.startsWith('/' + wpd.gettext('image') + '/')) {
            selectPath('/' + wpd.gettext('image'));
        } else if (path === '/' + wpd.gettext('datasets')) {
            onDatasetGroupSelection();
            showTreeItemWidget('dataset-group-tree-widget');
            activeAxes = null;
        } else if (path === '/' + wpd.gettext('axes')) {
            resetGraphics();
            showTreeItemWidget('axes-group-tree-widget');
            activeAxes = null;
        } else if (path === '/' + wpd.gettext('measurements')) {
            resetGraphics();
            showTreeItemWidget('measurement-group-tree-widget');
            activeAxes = null;
        } else if (path === '/' + wpd.gettext('measurements') + '/' + wpd.gettext('distance')) {
            if (!suppressSecondaryActions) {
                wpd.measurement.start(wpd.measurementModes.distance);
            }
            showTreeItemWidget('distance-item-tree-widget');
            renderDistanceAxesSelection();
        } else if (path === '/' + wpd.gettext('measurements') + '/' + wpd.gettext('angle')) {
            if (!suppressSecondaryActions) {
                wpd.measurement.start(wpd.measurementModes.angle);
            }
            showTreeItemWidget('angle-item-tree-widget');
            activeAxes = null;
        } else if (path === '/' + wpd.gettext('measurements') + '/' + wpd.gettext('area')) {
            if (!suppressSecondaryActions) {
                wpd.measurement.start(wpd.measurementModes.area);
            }
            showTreeItemWidget('area-item-tree-widget');
            renderAreaAxesSelection();
        } else if (path.startsWith('/' + wpd.gettext('datasets') + '/')) {
            onDatasetSelection(elem, path, suppressSecondaryActions);
        } else if (path.startsWith('/' + wpd.gettext('axes') + '/')) {
            onAxesSelection(elem, path, suppressSecondaryActions);
        } else {
            resetGraphics();
            showTreeItemWidget(null);
            activeAxes = null;
        }
    }

    function onRename(elem, path, suppressSecondaryActions) {
        if (path.startsWith("/" + wpd.gettext("datasets") + "/")) {
            wpd.dataSeriesManagement.showRenameDataset();
        } else if (path.startsWith("/" + wpd.gettext("axes") + "/")) {
            wpd.alignAxes.showRenameAxes();
        }
    }

    function init() {
        const $treeElem = document.getElementById("tree-container");
        treeWidget = new wpd.TreeWidget($treeElem);
        treeWidget.onItemSelection(onSelection)
        treeWidget.onItemRename(onRename);
        buildTree();
    }

    function refresh() {
        buildTree();
    }

    function refreshPreservingSelection(forceRefresh) {
        if (treeWidget != null) {
            const selectedPath = treeWidget.getSelectedPath();
            refresh();
            treeWidget.selectPath(selectedPath, !forceRefresh);
        } else {
            refresh();
        }
    }

    function selectPath(path, suppressSecondaryActions) {
        treeWidget.selectPath(path, suppressSecondaryActions);
    }

    function addMeasurement(mode) {
        wpd.measurement.start(mode);
        refresh();
        let suppressSecondaryActions = true;
        if (wpd.appData.isMultipage()) suppressSecondaryActions = false;
        if (mode === wpd.measurementModes.distance) {
            wpd.tree.selectPath("/" + wpd.gettext("measurements") + "/" + wpd.gettext("distance"),
                suppressSecondaryActions);
        } else if (mode === wpd.measurementModes.angle) {
            wpd.tree.selectPath("/" + wpd.gettext("measurements") + "/" + wpd.gettext("angle"),
                suppressSecondaryActions);
        } else if (mode === wpd.measurementModes.area) {
            wpd.tree.selectPath("/" + wpd.gettext("measurements") + "/" + wpd.gettext("area"),
                suppressSecondaryActions);
        }
    }

    function getActiveDataset() {
        return activeDataset;
    }

    function getActiveAxes() {
        return activeAxes;
    }

    return {
        init: init,
        refresh: refresh,
        refreshPreservingSelection: refreshPreservingSelection,
        selectPath: selectPath,
        addMeasurement: addMeasurement,
        getActiveDataset: getActiveDataset,
        getActiveAxes: getActiveAxes
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.webcamCapture = (function() {
    var cameraStream;

    function isSupported() {
        return !(getUserMedia() == null);
    }

    function unsupportedBrowser() {
        wpd.messagePopup.show(wpd.gettext('webcam-capture'), wpd.gettext('webcam-capture-text'));
    }

    function getUserMedia() {
        return navigator.getUserMedia || navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia || navigator.msGetUserMedia;
    }

    function start() {
        if (!isSupported()) {
            unsupportedBrowser();
            return;
        }
        wpd.popup.show('webcamCapture');
        var $camVideo = document.getElementById('webcamVideo');
        navigator.getUserMedia = getUserMedia();
        navigator.getUserMedia({
                video: true
            },
            function(stream) {
                cameraStream = stream;
                $camVideo.src = window.URL.createObjectURL(stream);
            },
            function() {});
    }

    function capture() {
        var $webcamCanvas = document.createElement('canvas'),
            $camVideo = document.getElementById('webcamVideo'),
            webcamCtx = $webcamCanvas.getContext('2d'),
            imageData;
        $webcamCanvas.width = $camVideo.videoWidth;
        $webcamCanvas.height = $camVideo.videoHeight;
        webcamCtx.drawImage($camVideo, 0, 0);
        imageData = webcamCtx.getImageData(0, 0, $webcamCanvas.width, $webcamCanvas.height);
        cameraOff();
        wpd.graphicsWidget.runImageOp(function() {
            return {
                imageData: imageData,
                width: $webcamCanvas.width,
                height: $webcamCanvas.height
            };
        });
    }

    function cameraOff() {
        if (cameraStream != undefined) {
            cameraStream.stop();
        }
        wpd.popup.close('webcamCapture');
    }

    function cancel() {
        cameraOff();
    }

    return {
        start: start,
        cancel: cancel,
        capture: capture
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.*/

/* Zoomed-in view */
var wpd = wpd || {};
wpd.zoomView = (function() {
    var zCanvas, zctx, tempCanvas, tctx, zWindowWidth = 250,
        zWindowHeight = 250,
        $mPosn, pix = [],
        zoomRatio, crosshairColorText = 'black';

    pix[0] = [];

    function init() {

        zCanvas = document.getElementById('zoomCanvas');
        zctx = zCanvas.getContext('2d');
        tempCanvas = document.createElement('canvas');
        tctx = tempCanvas.getContext('2d');

        $mPosn = document.getElementById('mousePosition');

        zoomRatio = 5;

        drawCrosshair();
    }

    function drawCrosshair() {
        var zCrossHair = document.getElementById("zoomCrossHair");
        var zchCtx = zCrossHair.getContext("2d");

        zCrossHair.width = zCrossHair.width;

        if (crosshairColorText === 'black') {
            zchCtx.strokeStyle = "rgba(0,0,0,1)";
        } else if (crosshairColorText === 'red') {
            zchCtx.strokeStyle = "rgba(255,0,0,1)";
        } else if (crosshairColorText === 'yellow') {
            zchCtx.strokeStyle = "rgba(255,255,0,1)";
        } else {
            zchCtx.strokeStyle = "rgba(0,0,0,1)";
        }

        zchCtx.beginPath();
        zchCtx.moveTo(zWindowWidth / 2, 0);
        zchCtx.lineTo(zWindowWidth / 2, zWindowHeight);
        zchCtx.moveTo(0, zWindowHeight / 2);
        zchCtx.lineTo(zWindowWidth, zWindowHeight / 2);
        zchCtx.stroke();
    }

    function setZoomRatio(zratio) {
        zoomRatio = zratio;
    }

    function getZoomRatio() {
        return zoomRatio;
    }

    function getSize() {
        return {
            width: zWindowWidth,
            height: zWindowHeight
        };
    }

    function setZoomImage(imgData, x0, y0, zwidth, zheight) {
        tempCanvas.width = zwidth / zoomRatio;
        tempCanvas.height = zheight / zoomRatio;
        tctx.putImageData(imgData, 0, 0);
        zCanvas.width = zCanvas.width;
        zctx.drawImage(tempCanvas, x0, y0, zwidth, zheight);
    }

    function setCoords(imageX, imageY) {
        const axes = wpd.tree.getActiveAxes();
        if (axes != null) {
            $mPosn.innerHTML = axes.pixelToLiveString(imageX, imageY);
        } else {
            $mPosn.innerHTML = imageX.toFixed(2) + ', ' + imageY.toFixed(2);
        }
    }

    function showSettingsWindow() {
        document.getElementById('zoom-magnification-value').value = zoomRatio;
        document.getElementById('zoom-crosshair-color-value').value = crosshairColorText;
        wpd.popup.show('zoom-settings-popup');
    }

    function applySettings() {
        zoomRatio = document.getElementById('zoom-magnification-value').value;
        crosshairColorText = document.getElementById('zoom-crosshair-color-value').value;
        drawCrosshair();
        wpd.popup.close('zoom-settings-popup');
    }

    return {
        initZoom: init,
        setZoomImage: setZoomImage,
        setCoords: setCoords,
        setZoomRatio: setZoomRatio,
        getZoomRatio: getZoomRatio,
        getSize: getSize,
        showSettingsWindow: showSettingsWindow,
        applySettings: applySettings
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/
var wpd = wpd || {};

wpd.AxesCornersTool = (function() {
    var Tool = function(calibration, reloadTool) {
        var pointCount = 0,
            _calibration = calibration,
            isCapturingCorners = true;

        if (reloadTool) {
            pointCount = _calibration.maxPointCount;
            isCapturingCorners = false;
        } else {
            pointCount = 0;
            isCapturingCorners = true;
            wpd.graphicsWidget.resetData();
        }

        this.onMouseClick = function(ev, pos, imagePos) {
            if (isCapturingCorners) {
                pointCount = pointCount + 1;

                _calibration.addPoint(imagePos.x, imagePos.y, 0, 0);
                _calibration.unselectAll();
                _calibration.selectPoint(pointCount - 1);
                wpd.graphicsWidget.forceHandlerRepaint();

                if (pointCount === _calibration.maxPointCount) {
                    isCapturingCorners = false;
                    wpd.alignAxes.calibrationCompleted();
                }

                wpd.graphicsWidget.updateZoomOnEvent(ev);
            } else {
                _calibration.unselectAll();
                // cal.selectNearestPoint(imagePos.x,
                // imagePos.y, 15.0/wpd.graphicsWidget.getZoomRatio());
                _calibration.selectNearestPoint(imagePos.x, imagePos.y);
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.graphicsWidget.updateZoomOnEvent(ev);
            }
        };

        this.onKeyDown = function(ev) {
            if (_calibration.getSelectedPoints().length === 0) {
                return;
            }

            var selPoint = _calibration.getPoint(_calibration.getSelectedPoints()[0]),
                pointPx = selPoint.px,
                pointPy = selPoint.py,
                stepSize = ev.shiftKey === true ? 5 / wpd.graphicsWidget.getZoomRatio() :
                0.5 / wpd.graphicsWidget.getZoomRatio();

            if (wpd.keyCodes.isUp(ev.keyCode)) {
                pointPy = pointPy - stepSize;
            } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                pointPy = pointPy + stepSize;
            } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                pointPx = pointPx - stepSize;
            } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                pointPx = pointPx + stepSize;
            } else {
                return;
            }

            _calibration.changePointPx(_calibration.getSelectedPoints()[0], pointPx, pointPy);
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomToImagePosn(pointPx, pointPy);
            ev.preventDefault();
            ev.stopPropagation();
        };
    };

    return Tool;
})();

wpd.AlignmentCornersRepainter = (function() {
    var Tool = function(calibration) {
        var _calibration = calibration;

        this.painterName = 'AlignmentCornersReptainer';

        this.onForcedRedraw = function() {
            wpd.graphicsWidget.resetData();
            this.onRedraw();
        };

        this.onRedraw = function() {
            if (_calibration == null) {
                return;
            }

            var i, imagePos, imagePx, fillStyle;

            for (i = 0; i < _calibration.getCount(); i++) {
                imagePos = _calibration.getPoint(i);
                imagePx = {
                    x: imagePos.px,
                    y: imagePos.py
                };

                if (_calibration.isPointSelected(i)) {
                    fillStyle = "rgba(0,200,0,1)";
                } else {
                    fillStyle = "rgba(200,0,0,1)";
                }

                wpd.graphicsHelper.drawPoint(imagePx, fillStyle, _calibration.labels[i],
                    _calibration.labelPositions[i]);
            }
        };
    };
    return Tool;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.ColorPickerTool = (function() {
    var Tool = function() {
        var ctx = wpd.graphicsWidget.getAllContexts();

        this.onMouseClick = function(ev, pos, imagePos) {
            var ir, ig, ib, ia, pixData;

            pixData = ctx.oriImageCtx.getImageData(imagePos.x, imagePos.y, 1, 1);
            ir = pixData.data[0];
            ig = pixData.data[1];
            ib = pixData.data[2];
            ia = pixData.data[3];
            if (ia === 0) { // for transparent color, assume white RGB
                ir = 255;
                ig = 255;
                ib = 255;
            }
            this.onComplete([ir, ig, ib]);
        };

        this.onComplete = function(col) {};
    };
    return Tool;
})();

wpd.ColorFilterRepainter = (function() {
    var Painter = function() {
        this.painterName = 'colorFilterRepainter';

        this.onRedraw = function() {
            var autoDetector = wpd.appData.getPlotData().getAutoDetector();
            wpd.colorSelectionWidget.paintFilteredColor(autoDetector.binaryData, autoDetector.mask);
        };
    };
    return Painter;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.graphicsHelper = (function() {
    // imagePx - relative to original image
    // fillStyle - e.g. "rgb(200,0,0)"
    // label - e.g. "Bar 0"
    // position - "N", "E", "S" (default), or "W"
    function drawPoint(imagePx, fillStyle, label, position) {
        var screenPx = wpd.graphicsWidget.screenPx(imagePx.x, imagePx.y),
            ctx = wpd.graphicsWidget.getAllContexts(),
            labelWidth,
            imageHeight = wpd.graphicsWidget.getImageSize().height;

        if (label != null) {
            // Display Data Canvas Layer
            ctx.dataCtx.font = "15px sans-serif";
            labelWidth = ctx.dataCtx.measureText(label).width;
            ctx.dataCtx.fillStyle = "rgba(255, 255, 255, 0.7)";

            // Original Image Data Canvas Layer
            // No translucent background for text here.
            ctx.oriDataCtx.font = "15px sans-serif";
            ctx.oriDataCtx.fillStyle = fillStyle;

            // Switch for both canvases
            switch (position) {
                case "N":
                case "n":
                    ctx.dataCtx.fillRect(screenPx.x - 13, screenPx.y - 24, labelWidth + 5, 35);
                    ctx.dataCtx.fillStyle = fillStyle;
                    ctx.dataCtx.fillText(label, screenPx.x - 10, screenPx.y - 7);
                    ctx.oriDataCtx.fillText(label, imagePx.x - 10, imagePx.y - 7);
                    break;
                case "E":
                case "e":
                    ctx.dataCtx.fillRect(screenPx.x - 7, screenPx.y - 16, labelWidth + 17, 26);
                    ctx.dataCtx.fillStyle = fillStyle;
                    ctx.dataCtx.fillText(label, screenPx.x + 7, screenPx.y + 5);
                    ctx.oriDataCtx.fillText(label, imagePx.x + 7, imagePx.y + 5);
                    break;
                case "W":
                case "w":
                    ctx.dataCtx.fillRect(screenPx.x - labelWidth - 10, screenPx.y - 16, labelWidth + 17,
                        26);
                    ctx.dataCtx.fillStyle = fillStyle;
                    ctx.dataCtx.fillText(label, screenPx.x - labelWidth - 7, screenPx.y + 5);
                    ctx.oriDataCtx.fillText(label, imagePx.x - labelWidth - 7, imagePx.y + 5);
                    break;
                default:
                    ctx.dataCtx.fillRect(screenPx.x - 13, screenPx.y - 8, labelWidth + 5, 35);
                    ctx.dataCtx.fillStyle = fillStyle;
                    ctx.dataCtx.fillText(label, screenPx.x - 10, screenPx.y + 18);
                    ctx.oriDataCtx.fillText(label, imagePx.x - 10, imagePx.y + 18);
            }
        }

        // Display Data Canvas Layer
        ctx.dataCtx.beginPath();
        ctx.dataCtx.fillStyle = fillStyle;
        ctx.dataCtx.strokeStyle = "rgb(255, 255, 255)";
        ctx.dataCtx.arc(screenPx.x, screenPx.y, 4, 0, 2.0 * Math.PI, true);
        ctx.dataCtx.fill();
        ctx.dataCtx.stroke();

        // Original Image Data Canvas Layer
        ctx.oriDataCtx.beginPath();
        ctx.oriDataCtx.fillStyle = fillStyle;
        ctx.oriDataCtx.strokeStyle = "rgb(255, 255, 255)";
        ctx.oriDataCtx.arc(imagePx.x, imagePx.y, imageHeight > 1500 ? 4 : 2, 0, 2.0 * Math.PI,
            true);
        ctx.oriDataCtx.fill();
        ctx.oriDataCtx.stroke();
    }

    return {
        drawPoint: drawPoint
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.GridColorFilterRepainter = (function() {
    var Painter = function() {
        this.painterName = 'gridColorFilterRepainter';

        this.onRedraw = function() {
            var autoDetector = wpd.appData.getPlotData().getGridDetectionData();
            wpd.colorSelectionWidget.paintFilteredColor(autoDetector.binaryData,
                autoDetector.gridMask.pixels);
        };
    };
    return Painter;
})();

// TODO: Think of reusing mask.js code here
wpd.GridBoxTool = (function() {
    var Tool = function() {
        var isDrawing = false,
            topImageCorner, topScreenCorner,
            ctx = wpd.graphicsWidget.getAllContexts(),
            moveTimer, screen_pos,

            mouseMoveHandler =
            function() {
                wpd.graphicsWidget.resetHover();
                ctx.hoverCtx.strokeStyle = "rgb(0,0,0)";
                ctx.hoverCtx.strokeRect(topScreenCorner.x, topScreenCorner.y,
                    screen_pos.x - topScreenCorner.x,
                    screen_pos.y - topScreenCorner.y);
            },

            mouseUpHandler =
            function(ev, pos, imagePos) {
                if (isDrawing === false) {
                    return;
                }
                clearTimeout(moveTimer);
                isDrawing = false;
                wpd.graphicsWidget.resetHover();
                ctx.dataCtx.fillStyle = "rgba(255,255,0,0.8)";
                ctx.dataCtx.fillRect(topScreenCorner.x, topScreenCorner.y,
                    pos.x - topScreenCorner.x, pos.y - topScreenCorner.y);
                ctx.oriDataCtx.fillStyle = "rgba(255,255,0,0.8)";
                ctx.oriDataCtx.fillRect(topImageCorner.x, topImageCorner.y,
                    imagePos.x - topImageCorner.x,
                    imagePos.y - topImageCorner.y);
            },

            mouseOutPos = null,
            mouseOutImagePos = null;

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.GridMaskPainter());
            document.getElementById('grid-mask-box').classList.add('pressed-button');
            document.getElementById('grid-mask-view').classList.add('pressed-button');
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            if (isDrawing === true)
                return;
            isDrawing = true;
            topImageCorner = imagePos;
            topScreenCorner = pos;
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            if (isDrawing === true) {
                clearTimeout(moveTimer);
                mouseOutPos = pos;
                mouseOutImagePos = imagePos;
            }
        };

        this.onDocumentMouseUp = function(ev, pos, imagePos) {
            if (mouseOutPos != null && mouseOutImagePos != null) {
                mouseUpHandler(ev, mouseOutPos, mouseOutImagePos);
            } else {
                mouseUpHandler(ev, pos, imagePos);
            }
            mouseOutPos = null;
            mouseOutImagePos = null;
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            mouseUpHandler(ev, pos, imagePos);
        };

        this.onRemove = function() {
            document.getElementById('grid-mask-box').classList.remove('pressed-button');
            document.getElementById('grid-mask-view').classList.remove('pressed-button');
            wpd.gridDetection.grabMask();
        };
    };
    return Tool;
})();

wpd.GridViewMaskTool = (function() {
    var Tool = function() {
        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.GridMaskPainter());
            document.getElementById('grid-mask-view').classList.add('pressed-button');
        };

        this.onRemove = function() {
            document.getElementById('grid-mask-view').classList.remove('pressed-button');
            wpd.gridDetection.grabMask();
        };
    };

    return Tool;
})();

wpd.GridMaskPainter = (function() {
    var Painter = function() {
        var ctx = wpd.graphicsWidget.getAllContexts(),
            autoDetector = wpd.appData.getPlotData().getGridDetectionData(),
            painter = function() {
                if (autoDetector.gridMask.pixels == null ||
                    autoDetector.gridMask.pixels.size === 0) {
                    return;
                }

                let imageSize = wpd.graphicsWidget.getImageSize();
                let imgData = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);

                for (let img_index of autoDetector.gridMask.pixels) {
                    imgData.data[img_index * 4] = 255;
                    imgData.data[img_index * 4 + 1] = 255;
                    imgData.data[img_index * 4 + 2] = 0;
                    imgData.data[img_index * 4 + 3] = 200;
                }

                ctx.oriDataCtx.putImageData(imgData, 0, 0);
                wpd.graphicsWidget.copyImageDataLayerToScreen();
            };

        this.painterName = 'gridMaskPainter';

        this.onRedraw = function() {
            wpd.gridDetection.grabMask();
            painter();
        };

        this.onAttach = function() {
            wpd.graphicsWidget.resetData();
            painter();
        };
    };
    return Painter;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.CropTool = class {

    constructor() {
        this._isDrawing = false;
        this._hasCropBox = false;
        this._isResizing = false;
        this._topImageCorner = null;
        this._topScreenCorner = null;
        this._moveTimer = null;
        this._screenPos = null;
        this._imagePos = null;
        this._hotspotCoords = null;
        this._resizingHotspot = '';
        this._resizeStartCoords = {
            x: 0,
            y: 0
        };
        this._ctx = wpd.graphicsWidget.getAllContexts();
    }

    onAttach() {
        document.getElementById('image-editing-crop').classList.add('pressed-button');
    }

    onRemove() {
        wpd.graphicsWidget.resetHover();
        document.getElementById('image-editing-crop').classList.remove('pressed-button');
    }

    onMouseDown(e, pos, imagePos) {
        if (!this._hasCropBox) {
            this._isDrawing = true;
            this._topImageCorner = imagePos;
            this._topScreenCorner = pos;
        } else {
            let hotspot = this._getHotspot(pos);
            if (hotspot != null) {
                // initiate resize/move action
                this._isResizing = true;
                this._resizeStartCoords = {
                    x: pos.x,
                    y: pos.y
                };
                this._resizingHotspot = hotspot;
            }
        }
    }

    onMouseMove(e, pos, imagePos) {
        if (this._isDrawing) {
            this._screenPos = pos;
            this._imagePos = imagePos;
            clearTimeout(this._moveTimer);
            this._moveTimer = setTimeout(() => {
                this._drawCropBox();
            }, 2);
        } else if (this._hasCropBox) {
            // reposition selected point (and others to match)
            let hotspot = this._isResizing ? this._resizingHotspot : this._getHotspot(pos);

            // set the appropriate cursor on hover or resize
            if (hotspot != null) {
                let cursor = "crosshair";
                if (hotspot === "n" || hotspot === "s") {
                    cursor = "ns-resize";
                } else if (hotspot == "e" || hotspot == "w") {
                    cursor = "ew-resize";
                } else if (hotspot == "nw" || hotspot == "se") {
                    cursor = "nwse-resize";
                } else if (hotspot == "ne" || hotspot == "sw") {
                    cursor = "nesw-resize";
                } else if (hotspot == "c") {
                    cursor = "move";
                }
                e.target.style.cursor = cursor;
            } else {
                e.target.style.cursor = "crosshair";
            }

            // resize or move based on hotspot
            if (this._isResizing) {
                let posDiff = {
                    x: pos.x - this._resizeStartCoords.x,
                    y: pos.y - this._resizeStartCoords.y
                };
                if (this._resizingHotspot == "n") {
                    this._topScreenCorner.y += posDiff.y;
                } else if (this._resizingHotspot == "s") {
                    this._screenPos.y += posDiff.y;
                } else if (this._resizingHotspot == "w") {
                    this._topScreenCorner.x += posDiff.x;
                } else if (this._resizingHotspot == "e") {
                    this._screenPos.x += posDiff.x;
                } else if (this._resizingHotspot == "nw") {
                    this._topScreenCorner.y += posDiff.y;
                    this._topScreenCorner.x += posDiff.x;
                } else if (this._resizingHotspot == "ne") {
                    this._topScreenCorner.y += posDiff.y;
                    this._screenPos.x += posDiff.x;
                } else if (this._resizingHotspot == "sw") {
                    this._screenPos.y += posDiff.y;
                    this._topScreenCorner.x += posDiff.x;
                } else if (this._resizingHotspot == "se") {
                    this._screenPos.y += posDiff.y;
                    this._screenPos.x += posDiff.x;
                } else if (this._resizingHotspot == "c") {
                    this._topScreenCorner.x += posDiff.x;
                    this._topScreenCorner.y += posDiff.y;
                    this._screenPos.x += posDiff.x;
                    this._screenPos.y += posDiff.y;
                }

                clearTimeout(this._moveTimer);
                this._moveTimer = setTimeout(() => {
                    this._drawCropBox();
                }, 2);

                this._resizeStartCoords = {
                    x: pos.x,
                    y: pos.y
                };
            }
        }
    }

    _drawCropBox() {
        wpd.graphicsWidget.resetHover();
        let ctx = this._ctx.hoverCtx;

        ctx.strokeStyle = "rgb(0,0,0)";
        ctx.strokeRect(this._topScreenCorner.x, this._topScreenCorner.y,
            this._screenPos.x - this._topScreenCorner.x,
            this._screenPos.y - this._topScreenCorner.y);

        this._hotspotCoords = this._getHotspotCoords();

        ctx.fillStyle = "rgb(255,0,0)";
        ctx.strokeStyle = "rgb(255,255,255)";
        for (let pt of this._hotspotCoords) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI, true);
            ctx.fill();
            ctx.stroke();
        }
    }

    onMouseUp(e, pos, imagePos) {
        this._finalizeDrawing();
    }

    _finalizeDrawing() {
        clearTimeout(this._moveTimer);
        if (!this._isDrawing && !this._isResizing)
            return;

        this._isDrawing = false;
        this._isResizing = false;
        this._hasCropBox = true;
        this._drawCropBox();
    }

    _getHotspotCoords() {
        return [{
                x: this._topScreenCorner.x,
                y: this._topScreenCorner.y
            }, // nw
            {
                x: this._screenPos.x,
                y: this._topScreenCorner.y
            }, // ne
            {
                x: this._screenPos.x,
                y: this._screenPos.y
            }, // se
            {
                x: this._topScreenCorner.x,
                y: this._screenPos.y
            }, // sw
            {
                x: (this._topScreenCorner.x + this._screenPos.x) / 2,
                y: this._topScreenCorner.y
            }, // n
            {
                x: this._screenPos.x,
                y: (this._topScreenCorner.y + this._screenPos.y) / 2
            }, // e
            {
                x: (this._topScreenCorner.x + this._screenPos.x) / 2,
                y: this._screenPos.y
            }, // s
            {
                x: this._topScreenCorner.x,
                y: (this._topScreenCorner.y + this._screenPos.y) / 2
            }, // w
            {
                x: (this._topScreenCorner.x + this._screenPos.x) / 2,
                y: (this._topScreenCorner.y + this._screenPos.y) / 2
            } // c
        ];
    }

    // is the screenPos on an active hotspot? if yes, then return the type
    _getHotspot(screenPos) {
        let hotspots = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'c'];
        let radius = 8; // distance from the center
        let pointCoords = this._hotspotCoords;
        for (let ptIdx = 0; ptIdx < pointCoords.length; ptIdx++) {
            let pt = pointCoords[ptIdx];
            let dist2 = (pt.x - screenPos.x) * (pt.x - screenPos.x) +
                (pt.y - screenPos.y) * (pt.y - screenPos.y);
            if (dist2 < radius * radius) {
                return hotspots[ptIdx];
            }
        }
        return null; // not on a hotspot
    }

    onMouseOut() {
        this._finalizeDrawing();
    }

    onDocumentMouseUp() {
        this._finalizeDrawing();
    }

    onKeyDown(e) {
        let isEsc = wpd.keyCodes.isEsc(e.keyCode);
        let isEnter = wpd.keyCodes.isEnter(e.keyCode);
        if (isEsc || isEnter) {
            this._isDrawing = false;
            wpd.graphicsWidget.resetHover();
        }

        if (isEsc) {
            this._hasCropBox = false;
        }

        if (isEnter && this._hasCropBox) {
            // execute the crop action
            let cropAction = new wpd.CropImageAction(this._topImageCorner.x, this._topImageCorner.y,
                this._imagePos.x, this._imagePos.y);
            wpd.appData.getUndoManager().insertAction(cropAction);
            cropAction.execute();
        }

        e.preventDefault();
    }

    onRedraw() {
        if (this._hasCropBox) {
            // recalculate screen coordinates and redraw crop-box
            this._topScreenCorner =
                wpd.graphicsWidget.screenPx(this._topImageCorner.x, this._topImageCorner.y);
            this._screenPos = wpd.graphicsWidget.screenPx(this._imagePos.x, this._imagePos.y);
            this._drawCropBox();
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.imageOps = (function() {
    function hflipOp(idata, iwidth, iheight) {
        var rowi, coli, index, mindex, tval, p;
        for (rowi = 0; rowi < iheight; rowi++) {
            for (coli = 0; coli < iwidth / 2; coli++) {
                index = 4 * (rowi * iwidth + coli);
                mindex = 4 * ((rowi + 1) * iwidth - (coli + 1));
                for (p = 0; p < 4; p++) {
                    tval = idata.data[index + p];
                    idata.data[index + p] = idata.data[mindex + p];
                    idata.data[mindex + p] = tval;
                }
            }
        }
        return {
            imageData: idata,
            width: iwidth,
            height: iheight
        };
    }

    function vflipOp(idata, iwidth, iheight) {
        var rowi, coli, index, mindex, tval, p;
        for (rowi = 0; rowi < iheight / 2; rowi++) {
            for (coli = 0; coli < iwidth; coli++) {
                index = 4 * (rowi * iwidth + coli);
                mindex = 4 * ((iheight - (rowi + 2)) * iwidth + coli);
                for (p = 0; p < 4; p++) {
                    tval = idata.data[index + p];
                    idata.data[index + p] = idata.data[mindex + p];
                    idata.data[mindex + p] = tval;
                }
            }
        }
        return {
            imageData: idata,
            width: iwidth,
            height: iheight
        };
    }

    function hflip() {
        wpd.graphicsWidget.runImageOp(hflipOp);
    }

    function vflip() {
        wpd.graphicsWidget.runImageOp(vflipOp);
    }

    return {
        hflip: hflip,
        vflip: vflip
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.keyCodes = {
    isUp: function(code) {
        return code === 38;
    },
    isDown: function(code) {
        return code === 40;
    },
    isLeft: function(code) {
        return code === 37;
    },
    isRight: function(code) {
        return code === 39;
    },
    isTab: function(code) {
        return code === 9;
    },
    isDel: function(code) {
        return code === 46;
    },
    isBackspace: function(code) {
        return code === 8;
    },
    isAlphabet: function(code, alpha) {
        if (code > 90 || code < 65) {
            return false;
        }
        return String.fromCharCode(code).toLowerCase() === alpha;
    },
    isPeriod: function(code) {
        return code === 190;
    },
    isComma: function(code) {
        return code === 188;
    },
    isEnter: function(code) {
        return code === 13;
    },
    isEsc: function(code) {
        return code === 27;
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.ManualSelectionTool = (function() {
    var Tool = function(axes, dataset) {
        this.onAttach = function() {
            document.getElementById('manual-select-button').classList.add('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));

            // show point group controls if set
            if (dataset.hasPointGroups()) {
                wpd.pointGroups.showControls();
                wpd.pointGroups.refreshControls();
            }
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            const addPixelArgs = [imagePos.x, imagePos.y];
            const hasPointGroups = dataset.hasPointGroups();

            const tupleIndex = wpd.pointGroups.getCurrentTupleIndex();
            const groupIndex = wpd.pointGroups.getCurrentGroupIndex();

            // handle bar axes labels
            let pointLabel = null;
            if (axes.dataPointsHaveLabels) {
                // only add a label if:
                // 1. point groups do not exist, or
                // 2. current group is a primary group (i.e. index 0)
                if (!hasPointGroups || groupIndex === 0) {
                    const mkeys = dataset.getMetadataKeys();
                    const labelKey = "label";

                    // update metadata keys on the dataset, if necessary
                    if (mkeys == null || !mkeys.length) {
                        // first metadata entry
                        dataset.setMetadataKeys([labelKey]);
                    } else if (mkeys.indexOf(labelKey) < 0) {
                        // first label entry (existing metadata)
                        dataset.setMetadataKeys([labelKey, ...mkeys]);
                    }

                    // generate label
                    let count = dataset.getCount();
                    if (hasPointGroups) {
                        if (tupleIndex === null) {
                            count = dataset.getTupleCount();
                        } else {
                            count = tupleIndex;
                        }
                    }
                    pointLabel = axes.dataPointsLabelPrefix + count;

                    // include label as point metadata
                    addPixelArgs.push({
                        [labelKey]: pointLabel
                    });
                }
            }

            // add the pixel to the dataset
            const index = dataset.addPixel(...addPixelArgs);

            // draw the point
            wpd.graphicsHelper.drawPoint(imagePos, dataset.colorRGB.toRGBString(), pointLabel);

            // update point group data
            if (hasPointGroups) {
                if (tupleIndex === null && groupIndex === 0) {
                    // record the point as a new tuple
                    const newTupleIndex = dataset.addTuple(index);
                    wpd.pointGroups.setCurrentTupleIndex(newTupleIndex);
                } else {
                    dataset.addToTupleAt(tupleIndex, groupIndex, index);
                }

                // switch to next point group
                wpd.pointGroups.nextGroup();
            }

            wpd.graphicsWidget.updateZoomOnEvent(ev);
            wpd.dataPointCounter.setCount(dataset.getCount());

            // If shiftkey was pressed while clicking on a point that has a label (e.g. bar charts),
            // then show a popup to edit the label
            if (axes.dataPointsHaveLabels && ev.shiftKey) {
                wpd.dataPointLabelEditor.show(dataset, dataset.getCount() - 1, this);
            }

            // dispatch point add event
            wpd.events.dispatch("wpd.dataset.point.add", {
                axes: axes,
                dataset: dataset,
                index: index
            });
        };

        this.onRemove = function() {
            document.getElementById('manual-select-button').classList.remove('pressed-button');

            // hide point group controls if set
            if (dataset.hasPointGroups()) {
                wpd.pointGroups.hideControls();
            }
        };

        this.onKeyDown = function(ev) {
            var lastPtIndex = dataset.getCount() - 1,
                lastPt = dataset.getPixel(lastPtIndex),
                stepSize = 0.5 / wpd.graphicsWidget.getZoomRatio();

            if (wpd.keyCodes.isUp(ev.keyCode)) {
                lastPt.y = lastPt.y - stepSize;
            } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                lastPt.y = lastPt.y + stepSize;
            } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                lastPt.x = lastPt.x - stepSize;
            } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                lastPt.x = lastPt.x + stepSize;
            } else if (wpd.keyCodes.isComma(ev.keyCode)) {
                wpd.pointGroups.previousGroup();
                return;
            } else if (wpd.keyCodes.isPeriod(ev.keyCode)) {
                wpd.pointGroups.nextGroup();
                return;
            } else if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
                return;
            } else {
                return;
            }

            dataset.setPixelAt(lastPtIndex, lastPt.x, lastPt.y);
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomToImagePosn(lastPt.x, lastPt.y);
            ev.preventDefault();
        };
    };
    return Tool;
})();

wpd.DeleteDataPointTool = (function() {
    var Tool = function(axes, dataset) {
        var ctx = wpd.graphicsWidget.getAllContexts();

        this.onAttach = function() {
            document.getElementById('delete-point-button').classList.add('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            const tupleCallback = (imagePos, index) => {
                let indexes = [];

                const tupleIndex = dataset.getTupleIndex(index);

                if (tupleIndex > -1) {
                    const indexes = dataset.getTuple(tupleIndex);

                    // sort indexes in descending order for removal
                    const indexesDesc = [...indexes].filter(i => i !== null).sort((a, b) => b - a);

                    // remove each data point in tuple
                    indexesDesc.forEach(idx => {
                        dataset.removePixelAtIndex(idx);
                        // update pixel references in tuples
                        dataset.refreshTuplesAfterPixelRemoval(idx);
                    });

                    // remove tuple
                    dataset.removeTuple(tupleIndex);

                    // update current tuple index pointer
                    wpd.pointGroups.previousGroup();
                } else {
                    // if tuple does not exist, just remove the pixel
                    indexes = [dataset.removeNearestPixel(imagePos.x, imagePos.y)];
                }

                finalCallback(indexes);
            };

            const pointCallback = (imagePos) => {
                const index = dataset.removeNearestPixel(imagePos.x, imagePos.y);

                // remove data point index references from tuples
                const tupleIndex = dataset.getTupleIndex(index);

                if (tupleIndex > -1) {
                    dataset.removeFromTupleAt(tupleIndex, index);

                    // update pixel references in tuples
                    dataset.refreshTuplesAfterPixelRemoval(index);

                    // remove tuple if no point index references left in tuple
                    if (dataset.isTupleEmpty(tupleIndex)) {
                        dataset.removeTuple(tupleIndex);
                    }

                    // update current tuple index pointer
                    wpd.pointGroups.previousGroup();
                }

                finalCallback([index]);
            };

            const finalCallback = (indexes) => {
                wpd.graphicsWidget.resetData();
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.graphicsWidget.updateZoomOnEvent(ev);
                wpd.dataPointCounter.setCount(dataset.getCount());

                // dispatch point delete event
                indexes.forEach(index => {
                    wpd.events.dispatch("wpd.dataset.point.delete", {
                        axes: axes,
                        dataset: dataset,
                        index: index
                    });
                });
            };

            // handle point tuple deletion
            if (dataset.hasPointGroups()) {
                const index = dataset.findNearestPixel(imagePos.x, imagePos.y);

                if (index > -1) {
                    // display tuple deletion confirmation popup if point groups exist
                    wpd.pointGroups.showDeleteTuplePopup(
                        tupleCallback.bind(this, imagePos, index),
                        pointCallback.bind(this, imagePos)
                    );
                }
            } else {
                pointCallback(imagePos);
            }
        };

        this.onKeyDown = function(ev) {
            if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
            }
        };

        this.onRemove = function() {
            document.getElementById('delete-point-button').classList.remove('pressed-button');
        };
    };
    return Tool;
})();

wpd.MultipltDatasetRepainter = class {
    constructor(axesList, datasetList) {
        this.painterName = "multipleDatasetsRepainter";
        this._datasetList = datasetList;
        this._axesList = axesList;

        // TODO: for each dataset, create a separate DataPointsRepainter
        this._datasetRepainters = [];
        for (let [dsIdx, ds] of datasetList.entries()) {
            let dsAxes = axesList[dsIdx];
            this._datasetRepainters.push(new wpd.DataPointsRepainter(dsAxes, ds));
        }
    }

    drawPoints() {
        for (let dsRepainter of this._datasetRepainters) {
            dsRepainter.drawPoints();
        }
    }

    onAttach() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }

    onRedraw() {
        this.drawPoints();
    }

    onForcedRedraw() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }
};

wpd.DataPointsRepainter = class {
    constructor(axes, dataset) {
        this._axes = axes;
        this._dataset = dataset;
        this.painterName = 'dataPointsRepainter';
    }

    drawPoints() {
        let mkeys = this._dataset.getMetadataKeys();
        let hasLabels = false;

        if (this._axes == null) {
            return; // this can happen when removing widgets when a new file is loaded:
        }

        if (this._axes.dataPointsHaveLabels && mkeys != null && mkeys[0] === 'label') {
            hasLabels = true;
        }

        for (let dindex = 0; dindex < this._dataset.getCount(); dindex++) {
            let imagePos = this._dataset.getPixel(dindex);
            let isSelected = this._dataset.getSelectedPixels().indexOf(dindex) >= 0;

            let fillStyle = isSelected ? "rgb(0,200,0)" : this._dataset.colorRGB.toRGBString();

            if (hasLabels) {
                let pointLabel = null;
                if (this._dataset.hasPointGroups()) {
                    // with point groups, bar labels only apply to points in the primary group (i.e. index 0)
                    const tupleIndex = this._dataset.getTupleIndex(dindex);
                    const groupIndex = this._dataset.getPointGroupIndexInTuple(tupleIndex, dindex);
                    if (groupIndex <= 0) {
                        if (imagePos.metadata !== undefined) {
                            pointLabel = imagePos.metadata.label;
                        }
                        const index = tupleIndex > -1 ? tupleIndex : dindex;
                        if (pointLabel == null) {
                            pointLabel = this._axes.dataPointsLabelPrefix + index;
                        }
                    }
                } else {
                    pointLabel = imagePos.metadata.label;
                    if (pointLabel == null) {
                        pointLabel = this._axes.dataPointsLabelPrefix + dindex;
                    }
                }
                wpd.graphicsHelper.drawPoint(imagePos, fillStyle, pointLabel);
            } else {
                wpd.graphicsHelper.drawPoint(imagePos, fillStyle);
            }
        }
    }

    onAttach() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }

    onRedraw() {
        this.drawPoints();
    }

    onForcedRedraw() {
        wpd.graphicsWidget.resetData();
        this.drawPoints();
    }
};

wpd.AdjustDataPointTool = (function() {
    const Tool = function(axes, dataset) {
        const $button = document.getElementById('manual-adjust-button');
        const $overrideSection = document.getElementById('value-overrides-controls');
        const $overrideButton = document.getElementById('override-data-values');

        // multi-select box
        let isMouseDown = false;
        let isSelecting = false;
        let _drawTimer = null;
        let p1 = null;
        let p2 = null;
        let imageP1 = null;
        let imageP2 = null;

        this.onAttach = function() {
            $button.classList.add('pressed-button');
            $overrideButton.classList.remove('pressed-button');
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
            wpd.toolbar.show('adjustDataPointsToolbar');
        };

        this.onRemove = function() {
            dataset.unselectAll();
            wpd.graphicsWidget.forceHandlerRepaint();
            $button.classList.remove('pressed-button');
            wpd.toolbar.clear();

            // hide override section
            $overrideSection.hidden = true;
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            isMouseDown = true;

            // record the first selection rectangle point
            p1 = pos;
            imageP1 = imagePos;

            // unselect everything
            dataset.unselectAll();
        };

        this.onMouseUp = function(ev, pos) {
            if (isSelecting === true) {
                // reset hover context to remove selection box drawing
                wpd.graphicsWidget.resetHover();

                // select points within the selection rectangle
                dataset.selectPixelsInRectangle(imageP1, imageP2);
                this._onSelect(ev, dataset.getSelectedPixels());

                // clear the draw timer
                clearTimeout(_drawTimer);

                // push these reset statements to the bottom of the events message queue
                setTimeout(function() {
                    isSelecting = false;
                    isMouseDown = false;
                    p1 = null;
                    p2 = null;

                    // reset hover context to remove previous selection box
                    wpd.graphicsWidget.resetHover();
                });
            } else {
                isMouseDown = false;
                p1 = null;
                p2 = null;

                // reset hover context to remove previous selection box
                wpd.graphicsWidget.resetHover();
            }
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isMouseDown === true) {
                isSelecting = true;

                // record the new position as the second selection rectangle point
                p2 = pos;
                imageP2 = imagePos;

                // refresh the selection rectangle every 1 ms
                clearTimeout(_drawTimer);
                _drawTimer = setTimeout(function() {
                    this._drawSelectionBox();
                }.bind(this), 1);
            }
        };

        this._drawSelectionBox = function() {
            // reset hover context to remove previous selection box
            wpd.graphicsWidget.resetHover();

            // fetch the hover context
            const ctx = wpd.graphicsWidget.getAllContexts().hoverCtx;

            // draw a black rectangle
            if (p1 != null && p2 != null) {
                ctx.strokeStyle = 'rgb(0,0,0)';
                ctx.strokeRect(
                    p1.x,
                    p1.y,
                    p2.x - p1.x,
                    p2.y - p1.y
                );
            }
        };

        this._onSelect = function(ev, pixelIndexes) {
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
            this.toggleOverrideSection(pixelIndexes);
            wpd.events.dispatch("wpd.dataset.point.select", {
                axes: axes,
                dataset: dataset,
                indexes: pixelIndexes
            });
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            if (isSelecting === false) {
                dataset.unselectAll();
                const pixelIndex = dataset.selectNearestPixel(imagePos.x, imagePos.y);
                this._onSelect(ev, [pixelIndex]);
            }
        };

        this.onKeyDown = function(ev) {
            if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
                wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
                return;
            }

            const selIndexes = dataset.getSelectedPixels();

            if (selIndexes.length < 1) {
                return;
            }

            // key strokes that do not need each point processed
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'r')) {
                wpd.dataPointValueOverrideEditor.show(dataset, axes, selIndexes, this);
                return;
            }

            // key strokes that need each point processed
            selIndexes.forEach(function(selIndex) {
                const stepSize = ev.shiftKey === true ? 5 / wpd.graphicsWidget.getZoomRatio() :
                    0.5 / wpd.graphicsWidget.getZoomRatio();

                let selPoint = dataset.getPixel(selIndex),
                    pointPx = selPoint.x,
                    pointPy = selPoint.y;

                if (wpd.keyCodes.isUp(ev.keyCode)) {
                    pointPy = pointPy - stepSize;
                } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                    pointPy = pointPy + stepSize;
                } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                    pointPx = pointPx - stepSize;
                } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                    pointPx = pointPx + stepSize;
                } else if (selIndexes.length === 1) {
                    // single selected point operations
                    if (wpd.keyCodes.isAlphabet(ev.keyCode, 'q')) {
                        dataset.selectPreviousPixel();
                        selIndex = dataset.getSelectedPixels()[0];
                        selPoint = dataset.getPixel(selIndex);
                        pointPx = selPoint.x;
                        pointPy = selPoint.y;
                    } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'w')) {
                        dataset.selectNextPixel();
                        selIndex = dataset.getSelectedPixels()[0];
                        selPoint = dataset.getPixel(selIndex);
                        pointPx = selPoint.x;
                        pointPy = selPoint.y;
                    } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'e')) {
                        if (axes.dataPointsHaveLabels) {
                            selIndex = dataset.getSelectedPixels()[0];
                            ev.preventDefault();
                            ev.stopPropagation();
                            wpd.dataPointLabelEditor.show(dataset, selIndex, this);
                            return;
                        }
                    } else if (wpd.keyCodes.isDel(ev.keyCode) || wpd.keyCodes.isBackspace(ev.keyCode)) {
                        dataset.removePixelAtIndex(selIndex);
                        dataset.unselectAll();
                        if (dataset.findNearestPixel(pointPx, pointPy) >= 0) {
                            dataset.selectNearestPixel(pointPx, pointPy);
                            selIndex = dataset.getSelectedPixels()[0];
                            selPoint = dataset.getPixel(selIndex);
                            pointPx = selPoint.x;
                            pointPy = selPoint.y;
                        }
                        wpd.graphicsWidget.resetData();
                        wpd.graphicsWidget.forceHandlerRepaint();
                        wpd.graphicsWidget.updateZoomToImagePosn(pointPx, pointPy);
                        wpd.dataPointCounter.setCount(dataset.getCount());
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    } else {
                        return;
                    }
                } else {
                    return;
                }

                dataset.setPixelAt(selIndex, pointPx, pointPy);
                wpd.graphicsWidget.updateZoomToImagePosn(pointPx, pointPy);
            }.bind(this));

            wpd.graphicsWidget.forceHandlerRepaint();
            ev.preventDefault();
            ev.stopPropagation();
        };

        this.toggleOverrideSection = function(pixelIndexes) {
            // Bar charts currently not supported
            const $overriddenIndicator = document.getElementById('overridden-data-indicator');

            // always start with overridden value indicator hidden
            $overriddenIndicator.hidden = true;

            if (
                // single pixel selection:
                // if selectNearestPixel does not find a pixel within the threshold
                // it returns -1
                (
                    pixelIndexes.length === 1 &&
                    pixelIndexes[0] >= 0
                ) ||
                pixelIndexes.length > 1
            ) {
                // display override section
                $overrideSection.hidden = false;

                // attach click handler for value edit popup
                $overrideButton.onclick = wpd.dataPointValueOverrideEditor.show.bind(
                    null,
                    dataset,
                    axes,
                    pixelIndexes,
                    this
                );

                // display overridden value indicator if at least one point has
                // one override value (unless the key is label)
                dataset.getSelectedPixels().some(index => {
                    const pixel = dataset.getPixel(index);
                    if (pixel.metadata) {
                        let threshold = 1;
                        if (pixel.metadata.hasOwnProperty('label')) {
                            threshold += 1;
                        }
                        if (Object.keys(pixel.metadata).length >= threshold) {
                            $overriddenIndicator.hidden = false;
                            return true;
                        }
                    }
                    return false;
                });
            } else {
                // no point(s) selected
                $overrideSection.hidden = true;

                // hide button and clear onclick handler
                $overrideButton.onclick = null;
            }
        };

        this.displayMask = function() {
            // create a mask that makes this tool appear to still be selected
            // when the override popup is engaged
            $button.classList.add('pressed-button');
            wpd.toolbar.show('adjustDataPointsToolbar');
            $overrideSection.hidden = false;
            $overrideButton.classList.add('pressed-button');
        };
    };
    return Tool;
})();

wpd.EditLabelsTool = function(axes, dataset) {
    this.onAttach = function() {
        document.getElementById('edit-data-labels').classList.add('pressed-button');
        wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));
    };

    this.onRemove = function() {
        document.getElementById('edit-data-labels').classList.remove('pressed-button');
        dataset.unselectAll();
    };

    this.onMouseClick = function(ev, pos, imagePos) {
        var dataSeries = dataset,
            pixelIndex;
        dataSeries.unselectAll();
        pixelIndex = dataSeries.selectNearestPixel(imagePos.x, imagePos.y);
        if (
            pixelIndex >= 0 &&
            (
                // if point groups exist, check that point is either not in a group
                // or in the primary group
                !dataSeries.hasPointGroups() || dataSeries.getPointGroupIndexInTuple(
                    dataSeries.getTupleIndex(pixelIndex),
                    pixelIndex
                ) <= 0
            )
        ) {
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
            wpd.dataPointLabelEditor.show(dataSeries, pixelIndex, this);
        }
    };

    this.onKeyDown = function(ev) {
        if (wpd.acquireData.isToolSwitchKey(ev.keyCode)) {
            wpd.acquireData.switchToolOnKeyPress(String.fromCharCode(ev.keyCode).toLowerCase());
        }
    };
};

wpd.dataPointCounter = {
    setCount: function(count) {
        let $counters = document.getElementsByClassName('data-point-counter');
        for (let ci = 0; ci < $counters.length; ci++) {
            $counters[ci].innerHTML = count;
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.BoxMaskTool = (function() {
    var Tool = function() {
        var isDrawing = false,
            topImageCorner, topScreenCorner,
            ctx = wpd.graphicsWidget.getAllContexts(),
            moveTimer, screen_pos,

            mouseMoveHandler =
            function() {
                wpd.graphicsWidget.resetHover();
                ctx.hoverCtx.strokeStyle = "rgb(0,0,0)";
                ctx.hoverCtx.strokeRect(topScreenCorner.x, topScreenCorner.y,
                    screen_pos.x - topScreenCorner.x,
                    screen_pos.y - topScreenCorner.y);
            },

            mouseUpHandler =
            function(ev, pos, imagePos) {
                if (isDrawing === false) {
                    return;
                }
                clearTimeout(moveTimer);
                isDrawing = false;
                wpd.graphicsWidget.resetHover();
                ctx.dataCtx.fillStyle = "rgba(255,255,0,1)";
                ctx.dataCtx.fillRect(topScreenCorner.x, topScreenCorner.y,
                    pos.x - topScreenCorner.x, pos.y - topScreenCorner.y);
                ctx.oriDataCtx.fillStyle = "rgba(255,255,0,1)";
                ctx.oriDataCtx.fillRect(topImageCorner.x, topImageCorner.y,
                    imagePos.x - topImageCorner.x,
                    imagePos.y - topImageCorner.y);
            },

            mouseOutPos = null,
            mouseOutImagePos = null;

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('box-mask').classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            if (isDrawing === true)
                return;
            isDrawing = true;
            topImageCorner = imagePos;
            topScreenCorner = pos;
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            if (isDrawing === true) {
                clearTimeout(moveTimer);
                mouseOutPos = pos;
                mouseOutImagePos = imagePos;
            }
        };

        this.onDocumentMouseUp = function(ev, pos, imagePos) {
            if (mouseOutPos != null && mouseOutImagePos != null) {
                mouseUpHandler(ev, mouseOutPos, mouseOutImagePos);
            } else {
                mouseUpHandler(ev, pos, imagePos);
            }
            mouseOutPos = null;
            mouseOutImagePos = null;
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            mouseUpHandler(ev, pos, imagePos);
        };

        this.onRemove = function() {
            document.getElementById('box-mask').classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            wpd.dataMask.grabMask();
        };
    };
    return Tool;
})();

wpd.PenMaskTool = (function() {
    var Tool = function() {
        var strokeWidth, ctx = wpd.graphicsWidget.getAllContexts(),
            isDrawing = false,
            moveTimer,
            screen_pos, image_pos, mouseMoveHandler = function() {
                ctx.dataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.dataCtx.lineTo(screen_pos.x, screen_pos.y);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.oriDataCtx.lineTo(image_pos.x, image_pos.y);
                ctx.oriDataCtx.stroke();
            };

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('pen-mask').classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
            document.getElementById('mask-paint-container').style.display = 'block';
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            if (isDrawing === true)
                return;
            var lwidth = parseInt(document.getElementById('paintThickness').value, 10);
            isDrawing = true;
            ctx.dataCtx.strokeStyle = "rgba(255,255,0,1)";
            ctx.dataCtx.lineWidth = lwidth * wpd.graphicsWidget.getZoomRatio();
            ctx.dataCtx.beginPath();
            ctx.dataCtx.moveTo(pos.x, pos.y);

            ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,1)";
            ctx.oriDataCtx.lineWidth = lwidth;
            ctx.oriDataCtx.beginPath();
            ctx.oriDataCtx.moveTo(imagePos.x, imagePos.y);
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            image_pos = imagePos;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            clearTimeout(moveTimer);
            ctx.dataCtx.closePath();
            ctx.dataCtx.lineWidth = 1;
            ctx.oriDataCtx.closePath();
            ctx.oriDataCtx.lineWidth = 1;
            isDrawing = false;
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            this.onMouseUp(ev, pos, imagePos);
        };

        this.onRemove = function() {
            document.getElementById('pen-mask').classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            document.getElementById('mask-paint-container').style.display = 'none';
            wpd.dataMask.grabMask();
            wpd.toolbar.clear();
        };
    };
    return Tool;
})();

wpd.EraseMaskTool = (function() {
    var Tool = function() {
        var strokeWidth, ctx = wpd.graphicsWidget.getAllContexts(),
            isDrawing = false,
            moveTimer,
            screen_pos, image_pos, mouseMoveHandler = function() {
                ctx.dataCtx.globalCompositeOperation = "destination-out";
                ctx.oriDataCtx.globalCompositeOperation = "destination-out";

                ctx.dataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.dataCtx.lineTo(screen_pos.x, screen_pos.y);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.strokeStyle = "rgba(255,255,0,1)";
                ctx.oriDataCtx.lineTo(image_pos.x, image_pos.y);
                ctx.oriDataCtx.stroke();
            };

        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('erase-mask').classList.add('pressed-button');
            document.getElementById('view-mask').classList.add('pressed-button');
            document.getElementById('mask-erase-container').style.display = 'block';
        };

        this.onMouseDown = function(ev, pos, imagePos) {
            if (isDrawing === true)
                return;
            var lwidth = parseInt(document.getElementById('eraseThickness').value, 10);
            isDrawing = true;
            ctx.dataCtx.globalCompositeOperation = "destination-out";
            ctx.oriDataCtx.globalCompositeOperation = "destination-out";

            ctx.dataCtx.strokeStyle = "rgba(0,0,0,1)";
            ctx.dataCtx.lineWidth = lwidth * wpd.graphicsWidget.getZoomRatio();
            ctx.dataCtx.beginPath();
            ctx.dataCtx.moveTo(pos.x, pos.y);

            ctx.oriDataCtx.strokeStyle = "rgba(0,0,0,1)";
            ctx.oriDataCtx.lineWidth = lwidth;
            ctx.oriDataCtx.beginPath();
            ctx.oriDataCtx.moveTo(imagePos.x, imagePos.y);
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isDrawing === false)
                return;
            screen_pos = pos;
            image_pos = imagePos;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(mouseMoveHandler, 2);
        };

        this.onMouseOut = function(ev, pos, imagePos) {
            this.onMouseUp(ev, pos, imagePos);
        };

        this.onMouseUp = function(ev, pos, imagePos) {
            clearTimeout(moveTimer);
            ctx.dataCtx.closePath();
            ctx.dataCtx.lineWidth = 1;
            ctx.oriDataCtx.closePath();
            ctx.oriDataCtx.lineWidth = 1;

            ctx.dataCtx.globalCompositeOperation = "source-over";
            ctx.oriDataCtx.globalCompositeOperation = "source-over";

            isDrawing = false;
        };

        this.onRemove = function() {
            document.getElementById('erase-mask').classList.remove('pressed-button');
            document.getElementById('view-mask').classList.remove('pressed-button');
            document.getElementById('mask-erase-container').style.display = 'none';
            wpd.dataMask.grabMask();
            wpd.toolbar.clear();
        };
    };
    return Tool;
})();

wpd.ViewMaskTool = (function() {
    var Tool = function() {
        this.onAttach = function() {
            wpd.graphicsWidget.setRepainter(new wpd.MaskPainter());
            document.getElementById('view-mask').classList.add('pressed-button');
        };

        this.onRemove = function() {
            document.getElementById('view-mask').classList.remove('pressed-button');
            wpd.dataMask.grabMask();
        };
    };

    return Tool;
})();

wpd.MaskPainter = (function() {
    var Painter = function() {
        let ctx = wpd.graphicsWidget.getAllContexts();
        let ds = wpd.tree.getActiveDataset();
        let autoDetector = wpd.appData.getPlotData().getAutoDetectionDataForDataset(ds);

        let painter = function() {
            if (autoDetector.mask == null || autoDetector.mask.size === 0) {
                return;
            }
            let imageSize = wpd.graphicsWidget.getImageSize();
            let imgData = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);

            for (let img_index of autoDetector.mask) {
                imgData.data[img_index * 4] = 255;
                imgData.data[img_index * 4 + 1] = 255;
                imgData.data[img_index * 4 + 2] = 0;
                imgData.data[img_index * 4 + 3] = 255;
            }

            ctx.oriDataCtx.putImageData(imgData, 0, 0);
            wpd.graphicsWidget.copyImageDataLayerToScreen();
        };

        this.painterName = 'dataMaskPainter';

        this.onRedraw = function() {
            wpd.dataMask.grabMask();
            painter();
        };

        this.onAttach = function() {
            wpd.graphicsWidget.resetData();
            painter();
        };
    };
    return Painter;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.AddMeasurementTool = (function() {
    var Tool = function(mode) {
        var ctx = wpd.graphicsWidget.getAllContexts(),
            pointsCaptured = 0,
            isCapturing = true,
            plist = [];

        this.onAttach = function() {
            document.getElementById(mode.addButtonId).classList.add('pressed-button');
            if (mode.connectivity < 0) { // area/perimeter
                document.getElementById("add-polygon-info").style.display = "block";
            }
        };

        this.onRemove = function() {
            document.getElementById(mode.addButtonId).classList.remove('pressed-button');
            if (mode.connectivity < 0) { // area/perimeter
                document.getElementById("add-polygon-info").style.display = "none";
            }
        };

        this.onKeyDown = function(ev) {
            // move the selected point or switch tools
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'a')) {
                wpd.graphicsWidget.resetHover();
                wpd.graphicsWidget.setTool(new wpd.AddMeasurementTool(mode));
                return;
            } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'd')) {
                wpd.graphicsWidget.resetHover();
                wpd.graphicsWidget.setTool(new wpd.DeleteMeasurementTool(mode));
                return;
            } else if ((wpd.keyCodes.isEnter(ev.keyCode) || wpd.keyCodes.isEsc(ev.keyCode)) &&
                isCapturing === true && mode.connectivity < 0) {
                isCapturing = false;
                mode.getData().addConnection(plist);
                wpd.graphicsWidget.resetHover();
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.graphicsWidget.setTool(new wpd.AdjustMeasurementTool(mode));
                return;
            }
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            if (isCapturing) {

                wpd.graphicsWidget.resetHover();

                plist[pointsCaptured * 2] = imagePos.x;
                plist[pointsCaptured * 2 + 1] = imagePos.y;
                pointsCaptured = pointsCaptured + 1;

                if (pointsCaptured === mode.connectivity) {
                    isCapturing = false;
                    mode.getData().addConnection(plist);
                    wpd.graphicsWidget.resetHover();
                    wpd.graphicsWidget.forceHandlerRepaint();
                    wpd.graphicsWidget.setTool(new wpd.AdjustMeasurementTool(mode));
                    return;
                }

                if (pointsCaptured > 1) {
                    // draw line from previous point to current
                    var prevScreenPx = wpd.graphicsWidget.screenPx(
                        plist[(pointsCaptured - 2) * 2], plist[(pointsCaptured - 2) * 2 + 1]);
                    ctx.dataCtx.beginPath();
                    ctx.dataCtx.strokeStyle = "rgb(0,0,10)";
                    ctx.dataCtx.moveTo(prevScreenPx.x, prevScreenPx.y);
                    ctx.dataCtx.lineTo(pos.x, pos.y);
                    ctx.dataCtx.stroke();

                    ctx.oriDataCtx.beginPath();
                    ctx.oriDataCtx.strokeStyle = "rgb(0,0,10)";
                    ctx.oriDataCtx.moveTo(plist[(pointsCaptured - 2) * 2],
                        plist[(pointsCaptured - 2) * 2 + 1]);
                    ctx.oriDataCtx.lineTo(imagePos.x, imagePos.y);
                    ctx.oriDataCtx.stroke();
                }

                // draw current point
                ctx.dataCtx.beginPath();
                ctx.dataCtx.fillStyle = "rgb(200, 0, 0)";
                ctx.dataCtx.arc(pos.x, pos.y, 3, 0, 2.0 * Math.PI, true);
                ctx.dataCtx.fill();

                ctx.oriDataCtx.beginPath();
                ctx.oriDataCtx.fillStyle = "rgb(200,0,0)";
                ctx.oriDataCtx.arc(imagePos.x, imagePos.y, 3, 0, 2.0 * Math.PI, true);
                ctx.oriDataCtx.fill();
            }
            wpd.graphicsWidget.updateZoomOnEvent(ev);
        };

        this.onMouseMove = function(ev, pos, imagePos) {
            if (isCapturing && pointsCaptured >= 1) {
                wpd.graphicsWidget.resetHover();
                var prevScreenPx = wpd.graphicsWidget.screenPx(plist[(pointsCaptured - 1) * 2],
                    plist[(pointsCaptured - 1) * 2 + 1]);

                ctx.hoverCtx.beginPath();
                ctx.hoverCtx.strokeStyle = "rgb(0,0,0)";
                ctx.hoverCtx.moveTo(prevScreenPx.x, prevScreenPx.y);
                ctx.hoverCtx.lineTo(pos.x, pos.y);
                ctx.hoverCtx.stroke();
            }
        };
    };
    return Tool;
})();

wpd.DeleteMeasurementTool = (function() {
    var Tool = function(mode) {
        var ctx = wpd.graphicsWidget.getAllContexts();

        this.onAttach = function() {
            document.getElementById(mode.deleteButtonId).classList.add('pressed-button');
        };

        this.onRemove = function() {
            document.getElementById(mode.deleteButtonId).classList.remove('pressed-button');
        };

        this.onKeyDown = function(ev) {
            // move the selected point or switch tools
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'a')) {
                wpd.graphicsWidget.setTool(new wpd.AddMeasurementTool(mode));
                return;
            } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'd')) {
                wpd.graphicsWidget.setTool(new wpd.DeleteMeasurementTool(mode));
                return;
            }
        };

        this.onMouseClick = function(ev, pos, imagePos) {
            mode.getData().deleteNearestConnection(imagePos.x, imagePos.y);
            wpd.graphicsWidget.setTool(new wpd.AdjustMeasurementTool(mode));
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
        };
    };
    return Tool;
})();

wpd.AdjustMeasurementTool = (function() {
    var Tool = function(mode) {
        this.onAttach = function() {};

        this.onMouseClick = function(ev, pos, imagePos) {
            // select the nearest point
            mode.getData().selectNearestPoint(imagePos.x, imagePos.y);
            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.graphicsWidget.updateZoomOnEvent(ev);
        };

        this.onKeyDown = function(ev) {
            // move the selected point or switch tools
            if (wpd.keyCodes.isAlphabet(ev.keyCode, 'a')) {
                wpd.graphicsWidget.setTool(new wpd.AddMeasurementTool(mode));
                return;
            } else if (wpd.keyCodes.isAlphabet(ev.keyCode, 'd')) {
                wpd.graphicsWidget.setTool(new wpd.DeleteMeasurementTool(mode));
                return;
            }

            var measurementData = mode.getData(),
                selectedPt = measurementData.getSelectedConnectionAndPoint();

            if (selectedPt.connectionIndex >= 0 && selectedPt.pointIndex >= 0) {

                var stepSize = ev.shiftKey === true ? 5 / wpd.graphicsWidget.getZoomRatio() :
                    0.5 / wpd.graphicsWidget.getZoomRatio(),
                    pointPx = measurementData.getPointAt(selectedPt.connectionIndex,
                        selectedPt.pointIndex);

                if (wpd.keyCodes.isUp(ev.keyCode)) {
                    pointPx.y = pointPx.y - stepSize;
                } else if (wpd.keyCodes.isDown(ev.keyCode)) {
                    pointPx.y = pointPx.y + stepSize;
                } else if (wpd.keyCodes.isLeft(ev.keyCode)) {
                    pointPx.x = pointPx.x - stepSize;
                } else if (wpd.keyCodes.isRight(ev.keyCode)) {
                    pointPx.x = pointPx.x + stepSize;
                } else {
                    return;
                }

                measurementData.setPointAt(selectedPt.connectionIndex, selectedPt.pointIndex,
                    pointPx.x, pointPx.y);
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.graphicsWidget.updateZoomToImagePosn(pointPx.x, pointPx.y);
                ev.preventDefault();
                ev.stopPropagation();
            }
        };
    };
    return Tool;
})();

wpd.MeasurementRepainter = (function() {
    var Painter = function(mode) {
        var ctx = wpd.graphicsWidget.getAllContexts(),

            drawLine =
            function(sx0, sy0, sx1, sy1, ix0, iy0, ix1, iy1) {
                ctx.dataCtx.beginPath();
                ctx.dataCtx.strokeStyle = "rgb(0,0,10)";
                ctx.dataCtx.moveTo(sx0, sy0);
                ctx.dataCtx.lineTo(sx1, sy1);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.beginPath();
                ctx.oriDataCtx.strokeStyle = "rgb(0,0,10)";
                ctx.oriDataCtx.moveTo(ix0, iy0);
                ctx.oriDataCtx.lineTo(ix1, iy1);
                ctx.oriDataCtx.stroke();
            },

            drawPoint =
            function(sx, sy, ix, iy, isSelected) {
                ctx.dataCtx.beginPath();
                if (isSelected) {
                    ctx.dataCtx.fillStyle = "rgb(0, 200, 0)";
                } else {
                    ctx.dataCtx.fillStyle = "rgb(200, 0, 0)";
                }
                ctx.dataCtx.arc(sx, sy, 3, 0, 2.0 * Math.PI, true);
                ctx.dataCtx.fill();

                ctx.oriDataCtx.beginPath();
                if (isSelected) {
                    ctx.oriDataCtx.fillStyle = "rgb(0,200,0)";
                } else {
                    ctx.oriDataCtx.fillStyle = "rgb(200,0,0)";
                }
                ctx.oriDataCtx.arc(ix, iy, 3, 0, 2.0 * Math.PI, true);
                ctx.oriDataCtx.fill();
            },

            drawArc =
            function(sx, sy, ix, iy, theta1, theta2) {
                ctx.dataCtx.beginPath();
                ctx.dataCtx.strokeStyle = "rgb(0,0,10)";
                ctx.dataCtx.arc(sx, sy, 15, theta1, theta2, true);
                ctx.dataCtx.stroke();

                ctx.oriDataCtx.beginPath();
                ctx.oriDataCtx.strokeStyle = "rgb(0,0,10)";
                ctx.oriDataCtx.arc(ix, iy, 15, theta1, theta2, true);
                ctx.oriDataCtx.stroke();
            },

            drawLabel =
            function(sx, sy, ix, iy, lab) {
                var labelWidth;

                sx = parseInt(sx, 10);
                sy = parseInt(sy, 10);
                ix = parseInt(ix, 10);
                iy = parseInt(iy, 10);

                ctx.dataCtx.font = "14px sans-serif";
                labelWidth = ctx.dataCtx.measureText(lab).width;
                ctx.dataCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
                ctx.dataCtx.fillRect(sx - 5, sy - 15, labelWidth + 10, 25);
                ctx.dataCtx.fillStyle = "rgb(200, 0, 0)";
                ctx.dataCtx.fillText(lab, sx, sy);

                ctx.oriDataCtx.font = "14px sans-serif";
                labelWidth = ctx.oriDataCtx.measureText(lab).width;
                ctx.oriDataCtx.fillStyle = "rgba(255, 255, 255, 0.7)";
                ctx.oriDataCtx.fillRect(ix - 5, iy - 15, labelWidth + 10, 25);
                ctx.oriDataCtx.fillStyle = "rgb(200, 0, 0)";
                ctx.oriDataCtx.fillText(lab, ix, iy);
            },

            drawDistances =
            function() {
                var distData = mode.getData(),
                    conn_count = distData.connectionCount(),
                    conni,
                    plist, x0, y0, x1, y1, spx0, spx1, dist, isSelected0, isSelected1,
                    axes = mode.getAxes();

                for (conni = 0; conni < conn_count; conni++) {
                    plist = distData.getConnectionAt(conni);
                    x0 = plist[0];
                    y0 = plist[1];
                    x1 = plist[2];
                    y1 = plist[3];
                    isSelected0 = distData.isPointSelected(conni, 0);
                    isSelected1 = distData.isPointSelected(conni, 1);
                    if (wpd.appData.isAligned() === true && axes instanceof wpd.MapAxes) {
                        dist = 'Dist' + conni.toString() + ': ' +
                            axes.pixelToDataDistance(distData.getDistance(conni)).toFixed(2) +
                            ' ' + axes.getUnits();
                    } else {
                        dist = 'Dist' + conni.toString() + ': ' +
                            distData.getDistance(conni).toFixed(2) + ' px';
                    }
                    spx0 = wpd.graphicsWidget.screenPx(x0, y0);
                    spx1 = wpd.graphicsWidget.screenPx(x1, y1);

                    // draw connecting lines:
                    drawLine(spx0.x, spx0.y, spx1.x, spx1.y, x0, y0, x1, y1);

                    // draw data points:
                    drawPoint(spx0.x, spx0.y, x0, y0, isSelected0);
                    drawPoint(spx1.x, spx1.y, x1, y1, isSelected1);

                    // distance label
                    drawLabel(0.5 * (spx0.x + spx1.x), 0.5 * (spx0.y + spx1.y), 0.5 * (x0 + x1),
                        0.5 * (y0 + y1), dist);
                }
            },

            drawAngles =
            function() {
                var angleData = mode.getData(),
                    conn_count = angleData.connectionCount(),
                    conni,
                    plist, x0, y0, x1, y1, x2, y2, spx0, spx1, spx2, theta1, theta2, theta,
                    isSelected0, isSelected1, isSelected2;
                for (conni = 0; conni < conn_count; conni++) {
                    plist = angleData.getConnectionAt(conni);
                    x0 = plist[0];
                    y0 = plist[1];
                    x1 = plist[2];
                    y1 = plist[3];
                    x2 = plist[4];
                    y2 = plist[5];
                    isSelected0 = angleData.isPointSelected(conni, 0);
                    isSelected1 = angleData.isPointSelected(conni, 1);
                    isSelected2 = angleData.isPointSelected(conni, 2);
                    theta = 'Theta' + conni.toString() + ': ' +
                        angleData.getAngle(conni).toFixed(2) + '°';
                    theta1 = Math.atan2((y0 - y1), x0 - x1);
                    theta2 = Math.atan2((y2 - y1), x2 - x1);
                    spx0 = wpd.graphicsWidget.screenPx(x0, y0);
                    spx1 = wpd.graphicsWidget.screenPx(x1, y1);
                    spx2 = wpd.graphicsWidget.screenPx(x2, y2);

                    // draw connecting lines:
                    drawLine(spx0.x, spx0.y, spx1.x, spx1.y, x0, y0, x1, y1);
                    drawLine(spx1.x, spx1.y, spx2.x, spx2.y, x1, y1, x2, y2);

                    // draw data points:
                    drawPoint(spx0.x, spx0.y, x0, y0, isSelected0);
                    drawPoint(spx1.x, spx1.y, x1, y1, isSelected1);
                    drawPoint(spx2.x, spx2.y, x2, y2, isSelected2);

                    // draw angle arc:
                    drawArc(spx1.x, spx1.y, x1, y1, theta1, theta2);

                    // angle label
                    drawLabel(spx1.x + 10, spx1.y + 15, x1 + 10, y1 + 15, theta);
                }
            },

            drawPolygons = function() {
                let connData = mode.getData();
                let connCount = connData.connectionCount();
                let axes = mode.getAxes();
                for (let connIdx = 0; connIdx < connCount; connIdx++) {
                    let conn = connData.getConnectionAt(connIdx);
                    let labelx = 0.0,
                        labely = 0.0;

                    let px_prev = 0,
                        py_prev = 0,
                        spx_prev = {
                            x: 0,
                            y: 0
                        };
                    for (let pi = 0; pi < conn.length; pi += 2) {
                        let px = conn[pi];
                        let py = conn[pi + 1];
                        let spx = wpd.graphicsWidget.screenPx(px, py);

                        if (pi >= 2) {
                            drawLine(spx_prev.x, spx_prev.y, spx.x, spx.y, px_prev, py_prev, px,
                                py);
                        }

                        if (pi == conn.length - 2) {
                            let px0 = conn[0];
                            let py0 = conn[1];
                            let spx0 = wpd.graphicsWidget.screenPx(px0, py0);
                            drawLine(spx0.x, spx0.y, spx.x, spx.y, px0, py0, px, py);
                        }

                        px_prev = px;
                        py_prev = py;
                        spx_prev = spx;
                    }

                    for (let pi = 0; pi < conn.length; pi += 2) {
                        let px = conn[pi];
                        let py = conn[pi + 1];
                        let spx = wpd.graphicsWidget.screenPx(px, py);
                        let isSelected = connData.isPointSelected(connIdx, pi / 2);
                        drawPoint(spx.x, spx.y, px, py, isSelected);
                        labelx += px;
                        labely += py;
                    }
                    labelx /= conn.length / 2;
                    labely /= conn.length / 2;
                    let labelspx = wpd.graphicsWidget.screenPx(labelx, labely);
                    let areaStr = "";
                    let periStr = "";
                    if (wpd.appData.isAligned() === true && axes instanceof wpd.MapAxes) {
                        areaStr = "Area" + connIdx + ": " +
                            axes.pixelToDataArea(connData.getArea(connIdx)).toFixed(2) + ' ' +
                            axes.getUnits() + '^2';
                        periStr =
                            "Perimeter" + connIdx + ": " +
                            axes.pixelToDataDistance(connData.getPerimeter(connIdx)).toFixed(2) +
                            ' ' + axes.getUnits();
                    } else {
                        areaStr = "Area" + connIdx + ": " + connData.getArea(connIdx).toFixed(2) +
                            ' px^2';
                        periStr = "Perimeter" + connIdx + ": " +
                            connData.getPerimeter(connIdx).toFixed(2) + ' px';
                    }
                    let label = areaStr + ", " + periStr;
                    drawLabel(labelspx.x, labelspx.y, labelx, labely, label);
                }
            };

        this.painterName = 'measurementRepainter-' + mode.name;

        this.onAttach = function() {};

        this.onRedraw = function() {
            if (mode.name === wpd.measurementModes.distance.name) {
                drawDistances();
            } else if (mode.name === wpd.measurementModes.angle.name) {
                drawAngles();
            } else if (mode.name === wpd.measurementModes.area.name) {
                drawPolygons();
            }
        };

        this.onForcedRedraw = function() {
            wpd.graphicsWidget.resetData();
            this.onRedraw();
        };
    };
    return Painter;
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.args = (function() {
    // Simple argument parser
    // e.g.
    // if WPD is launched as http://localhost:8000/index.html?q=1
    // then getValue('q') should return '1'
    // and getValue('nonexistent') should return null
    function getValue(arg) {

        var searchString = window.location.search.substring(1),
            i, val,
            params = searchString.split("&");

        for (i = 0; i < params.length; i++) {
            val = params[i].split("=");
            if (val[0] === arg) {
                return unescape(val[1]);
            }
        }
        return null;
    }

    return {
        getValue: getValue
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.dataExport = (function() {
    function show() {
        // open dialog box explaining data format
    }

    function getValueAtPixel(ptIndex, axes, pixel) {
        var val = axes.pixelToData(pixel.x, pixel.y);
        if (axes instanceof wpd.XYAxes) {
            for (var i = 0; i <= 1; i++) {
                if (axes.isDate(i)) {
                    var dformat = axes.getInitialDateFormat(i);
                    val[i] = wpd.dateConverter.formatDateNumber(val[i], dformat);
                }
            }
        } else if (axes instanceof wpd.BarAxes) {
            val = ['', val[0]];
            if (pixel.metadata == null) {
                val[0] = "Bar" + ptIndex;
            } else {
                val[0] = pixel.metadata[0];
            }
        }
        return val;
    }

    function generateCSV() {
        wpd.popup.close('export-all-data-popup');
        // generate file and trigger download

        // loop over all datasets
        let plotData = wpd.appData.getPlotData();
        let dsColl = plotData.getDatasets();

        if (dsColl == null || dsColl.length === 0) {
            // axes is not aligned, show an error message?
            wpd.messagePopup.show(wpd.gettext('no-datasets-to-export-error'),
                wpd.gettext('no-datasets-to-export'));
            return;
        }

        let maxDatapts = 0;
        let header = [];
        let varheader = [];
        let valData = [];
        let numCols = 0;

        for (let i = 0; i < dsColl.length; i++) {
            let axes = plotData.getAxesForDataset(dsColl[i]);
            if (axes == null)
                continue;
            let axLab = axes.getAxesLabels();
            let axdims = axLab.length;
            numCols += axdims;
            let pts = dsColl[i].getCount();
            if (pts > maxDatapts) {
                maxDatapts = pts;
            }
            header.push(dsColl[i].name);
            for (let j = 0; j < axdims; j++) {
                if (j !== 0) {
                    header.push('');
                }
                varheader.push(axLab[j]);
            }
        }
        for (let i = 0; i < maxDatapts; i++) {
            var valRow = [];
            for (let j = 0; j < numCols; j++) {
                valRow.push('');
            }
            valData.push(valRow);
        }

        let colIdx = 0;
        for (let i = 0; i < dsColl.length; i++) {
            let axes = plotData.getAxesForDataset(dsColl[i]);
            if (axes == null)
                continue;
            let axLab = axes.getAxesLabels();
            let axdims = axLab.length;
            let pts = dsColl[i].getCount();
            for (let j = 0; j < pts; j++) {
                let px = dsColl[i].getPixel(j);
                let val = getValueAtPixel(j, axes, px);
                for (let di = 0; di < axdims; di++) {
                    valData[j][colIdx + di] = val[di];
                }
            }
            colIdx += axdims;
        }

        let csvText = header.join(',') + '\n' + varheader.join(',') + '\n';
        for (let i = 0; i < maxDatapts; i++) {
            csvText += valData[i].join(',') + '\n';
        }

        // download
        wpd.download.csv(csvText, "wpd_datasets.csv");
    }

    function exportToPlotly() {
        wpd.popup.close('export-all-data-popup');

        // loop over all datasets
        var plotData = wpd.appData.getPlotData(),
            dsColl = plotData.getDatasets(),
            i, coli, rowi,
            dataProvider = wpd.plotDataProvider,
            pdata, plotlyData = {
                "data": []
            },
            colName;

        if (dsColl == null || dsColl.length === 0) {
            // axes is not aligned, show an error message?
            wpd.messagePopup.show(wpd.gettext('no-datasets-to-export-error'),
                wpd.gettext('no-datasets-to-export'));
            return;
        }

        for (i = 0; i < dsColl.length; i++) {
            dataProvider.setDataSource(dsColl[i]);
            pdata = dataProvider.getData();
            plotlyData.data[i] = {};

            // loop over columns
            for (coli = 0; coli < 2; coli++) {
                colName = (coli === 0) ? 'x' : 'y';
                plotlyData.data[i][colName] = [];
                for (rowi = 0; rowi < pdata.rawData.length; rowi++) {
                    if (pdata.fieldDateFormat[coli] != null) {
                        plotlyData.data[i][colName][rowi] = wpd.dateConverter.formatDateNumber(
                            pdata.rawData[rowi][coli], "yyyy-mm-dd hh:ii:ss");
                    } else {
                        plotlyData.data[i][colName][rowi] = pdata.rawData[rowi][coli];
                    }
                }
            }
        }

        wpd.plotly.send(plotlyData);
    }

    return {
        show: show,
        generateCSV: generateCSV,
        exportToPlotly: exportToPlotly
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.download = (function() {

    function textFile(data, filename) {
        let $downloadElem = document.createElement('a');
        $downloadElem.href = URL.createObjectURL(new Blob([data]), {
            type: "text/plain"
        });
        $downloadElem.download = stripIllegalCharacters(filename);
        $downloadElem.style.display = "none";
        document.body.appendChild($downloadElem);
        $downloadElem.click();
        document.body.removeChild($downloadElem);
    }

    function json(jsonData, filename) {
        if (filename == null) {
            filename = 'wpd_plot_data.json';
        }
        textFile(jsonData, filename);
    }

    function csv(csvData, filename) {
        if (filename == null) {
            filename = 'data.csv';
        }
        textFile(csvData, filename);
    }

    function stripIllegalCharacters(filename) {
        return filename.replace(/[^a-zA-Z\d+\.\-_\s]/g, "_");
    }

    return {
        json: json,
        csv: csv
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.events = (function() {
    let _registeredEvents = {};

    // polyfill for IE9+
    if (typeof window.CustomEvent !== "function") {
        window.CustomEvent = function(event, params) {
            params = params || {
                bubbles: false,
                cancelable: false,
                detail: null
            };

            var evt = document.createEvent("CustomEvent");
            evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);

            return evt;
        };
    }

    function dispatch(type, payload) {
        // only dispatch events if registered
        if (_isRegisteredEvent(type)) {
            window.dispatchEvent(new CustomEvent(type, {
                detail: payload
            }));
        }
    }

    function addListener(type, handler) {
        // only the payload ("detail") really matters here
        const func = (ev) => {
            handler(ev.detail);
        };

        window.addEventListener(type, func);

        _registerEvent(type, func);

        return func;
    }

    function removeListener(type, handler) {
        // note: to remove the listener, pass in the
        // handler returned by addListener
        window.removeEventListener(type, handler);

        _unregisterEvent(type, handler);
    }

    function removeAllListeners(type) {
        const removeListenersForType = (key) => {
            while (_registeredEvents[key]) {
                removeListener(key, _registeredEvents[key][0]);
            }
        };

        if (type) {
            if (_isRegisteredEvent(type)) {
                removeListenersForType(type);
            }
        } else {
            for (const registeredType in _registeredEvents) {
                removeListenersForType(registeredType);
            }
        }
    }

    function _isRegisteredEvent(type) {
        return _registeredEvents[type] && _registeredEvents[type].length > 0;
    }

    function _registerEvent(type, handler) {
        if (_registeredEvents[type]) {
            _registeredEvents[type].push(handler);
        } else {
            _registeredEvents[type] = [handler];
        }
    }

    function _unregisterEvent(type, handler) {
        if (_isRegisteredEvent(type)) {
            if (handler) {
                const index = _registeredEvents[type].indexOf(handler);

                if (index >= 0) {
                    _registeredEvents[type].splice(index, 1);
                }

                // delete key if there are no handlers registered
                if (_registeredEvents[type].length === 0) {
                    delete _registeredEvents[type];
                }
            } else {
                // unregister all handlers
                delete _registeredEvents[type];
            }
        } else {
            // no type specified; unregister everything
            _registeredEvents = {};
        }
    }

    function getRegisteredEvents() {
        return _registeredEvents;
    }

    return {
        dispatch: dispatch,
        addListener: addListener,
        removeListener: removeListener,
        removeAllListeners: removeAllListeners,
        getRegisteredEvents: getRegisteredEvents
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.log = function() {
    // Capture some basic info that helps WPD development.
    // Never capture anything about the data here!

    // if we're running inside electron, then skip
    if (wpd.browserInfo.isElectronBrowser()) {
        return;
    }

    // if server has disabled logging, then skip
    fetch("log").then(function(response) {
        return response.text();
    }).then(function(text) {
        if (text == "true") {
            // logging is enabled
            let data = {};
            data["screen-size"] = window.screen.width + "x" + window.screen.height;
            data["document-location"] = document.location.href;
            data["document-referrer"] = document.referrer;
            data["platform"] = window.navigator.platform;
            data["userAgent"] = window.navigator.userAgent;
            data["language"] = window.navigator.language;
            fetch("log", {
                method: 'post',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
        }
    });
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.plotly = (function() {
    function send(dataObject) {
        var formContainer = document.createElement('div'),
            formElement = document.createElement('form'),
            formData = document.createElement('textarea'),
            jsonString;

        formElement.setAttribute('method', 'post');
        formElement.setAttribute('action', 'https://plot.ly/external');
        formElement.setAttribute('target', '_blank');

        formData.setAttribute('name', 'data');
        formData.setAttribute('id', 'data');

        formElement.appendChild(formData);
        formContainer.appendChild(formElement);
        document.body.appendChild(formContainer);
        formContainer.style.display = 'none';

        jsonString = JSON.stringify(dataObject);

        formData.innerHTML = jsonString;
        formElement.submit();
        document.body.removeChild(formContainer);
    }

    return {
        send: send
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.saveResume = (function() {
    function save() {
        wpd.popup.show('export-json-window');
    }

    function load() {
        wpd.popup.show('import-json-window');
    }

    function resumeFromJSON(json_data) {
        const plotData = wpd.appData.getPlotData();
        const metadata = plotData.deserialize(json_data);
        _loadMetadata(metadata);
        wpd.tree.refresh();
    }

    function generateJSON() {
        const plotData = wpd.appData.getPlotData();
        const metadata = wpd.appData.getFileManager().getMetadata();
        return JSON.stringify(plotData.serialize(metadata));
    }

    function _loadMetadata(metadata) {
        let data = {};
        if (metadata && Object.keys(metadata).length !== 0) {
            data = metadata;
        }
        wpd.appData.getFileManager().loadMetadata(data);
    }

    function stripIllegalCharacters(filename) {
        return filename.replace(/[^a-zA-Z\d+\.\-_\s]/g, "_");
    }

    function downloadJSON() {
        // get project name
        let projectName =
            stripIllegalCharacters(document.getElementById("project-name-input").value) + ".json";

        wpd.download.json(generateJSON(), projectName);
        wpd.popup.close('export-json-window');
    }

    function _writeAndDownloadTar(projectName, json, imageFiles, imageFileNames) {
        // projectInfo
        let projectInfo =
            JSON.stringify({
                'version': [4, 0],
                'json': 'wpd.json',
                'images': imageFileNames
            });

        // generate project file
        let tarWriter = new tarball.TarWriter();
        tarWriter.addFolder(projectName + '/');
        tarWriter.addTextFile(projectName + '/info.json', projectInfo);
        tarWriter.addTextFile(projectName + '/wpd.json', json);
        for (let i = 0; i < imageFiles.length; i++) {
            tarWriter.addFile(projectName + '/' + imageFileNames[i], imageFiles[i]);
        }
        return tarWriter.download(projectName + '.tar');
    }

    function downloadProject() {
        // get project name
        const projectName =
            stripIllegalCharacters(document.getElementById('project-name-input').value);

        // get JSON
        const json = generateJSON();

        // get images, write everything to a tar, and initiate download
        wpd.busyNote.show();
        wpd.graphicsWidget.getImageFiles().then(imageFiles => {
            const imageFileNames = imageFiles.map(file => file.name);
            _writeAndDownloadTar(projectName, json, imageFiles, imageFileNames).then(
                wpd.busyNote.close()
            );
        });
        wpd.popup.close('export-json-window');
    }

    function readJSONFileOnly(jsonFile) {
        var fileReader = new FileReader();
        fileReader.onload = function() {
            var json_data = JSON.parse(fileReader.result);
            resumeFromJSON(json_data);

            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.removeTool();
            wpd.graphicsWidget.removeRepainter();
            wpd.tree.refresh();
            wpd.messagePopup.show(wpd.gettext('import-json'), wpd.gettext("json-data-loaded"));
            afterProjectLoaded();
        };
        fileReader.readAsText(jsonFile);
    }

    function readProjectFile(file) {
        wpd.busyNote.show();
        var tarReader = new tarball.TarReader();
        tarReader.readFile(file).then(
            function(fileInfo) {
                wpd.busyNote.close();
                const infoIndex = fileInfo.findIndex(info => info.name.endsWith('/info.json'));
                if (infoIndex >= 0) {
                    const projectName = fileInfo[infoIndex].name.replace('/info.json', '');

                    let wpdimages = [];
                    fileInfo.filter((info) => {
                        return info.type === 'file' && !info.name.endsWith('.json');
                    }).forEach((info) => {
                        let mimeType = '';
                        if (info.name.endsWith('.pdf')) {
                            mimeType = 'application/pdf';
                        } else {
                            mimeType = 'image/png';
                        }
                        const nameRegexp = new RegExp(projectName + '/', 'i');
                        const wpdimage = tarReader.getFileBlob(info.name, mimeType);
                        wpdimage.name = info.name.replace(nameRegexp, '');
                        wpdimages.push(wpdimage);
                    });

                    let wpdjson = JSON.parse(tarReader.getTextFile(projectName + '/wpd.json'));

                    wpd.imageManager.initializeFileManager(wpdimages);
                    wpd.imageManager.loadFromFile(wpdimages[0], true).then(() => {
                        resumeFromJSON(wpdjson);
                        wpd.tree.refresh();
                        wpd.messagePopup.show(wpd.gettext('import-json'),
                            wpd.gettext('json-data-loaded'));
                        afterProjectLoaded();
                    });
                }
            },
            function(err) {
                console.log(err);
            });
    }

    function afterProjectLoaded() {
        const plotData = wpd.appData.getPlotData();
        // if we have a bunch of datasets, then select the dataset group
        if (plotData.getDatasetCount() > 0) {
            wpd.tree.selectPath("/" + wpd.gettext("datasets"));
        }
    }

    function read() {
        const $fileInput = document.getElementById('import-json-file');
        wpd.popup.close('import-json-window');
        if ($fileInput.files.length === 1) {
            let file = $fileInput.files[0];
            let fileType = file.type;
            if (fileType == "" || fileType == null) {
                // Chrome on Windows
                if (file.name.endsWith(".json")) {
                    fileType = "application/json";
                } else if (file.name.endsWith(".tar")) {
                    fileType = "application/x-tar";
                }
            }
            if (fileType == "application/json") {
                readJSONFileOnly(file);
            } else if (fileType == "application/x-tar") {
                readProjectFile(file);
            } else {
                wpd.messagePopup.show(wpd.gettext("invalid-project"),
                    wpd.gettext("invalid-project-msg"));
            }
        }
    }

    return {
        save: save,
        load: load,
        downloadJSON: downloadJSON,
        downloadProject: downloadProject,
        read: read,
        readProjectFile: readProjectFile
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.scriptInjector = (function() {
    function start() {
        wpd.popup.show('runScriptPopup');
    }

    function cancel() {
        wpd.popup.close('runScriptPopup');
    }

    function load() {
        var $scriptFileInput = document.getElementById('runScriptFileInput');
        wpd.popup.close('runScriptPopup');
        if ($scriptFileInput.files.length == 1) {
            var fileReader = new FileReader();
            fileReader.onload = function() {
                if (typeof wpdscript !== "undefined") {
                    wpdscript = null;
                }
                eval(fileReader.result);
                if (typeof wpdscript !== "wpdscript") {
                    window["wpdscript"] = wpdscript;
                    wpdscript.run();
                }
            };
            fileReader.readAsText($scriptFileInput.files[0]);
        }
    }

    function injectHTML() {}

    function injectCSS() {}

    return {
        start: start,
        cancel: cancel,
        load: load
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

// maintain and manage current state of the application
wpd.appData = (function() {
    let _plotData = null;
    let _undoManager = null;
    let _pageManager = null;
    let _fileManager = null;

    function reset() {
        _plotData = null;
        _undoManager = null;
    }

    function getPlotData() {
        if (_plotData == null) {
            _plotData = new wpd.PlotData();
        }
        return _plotData;
    }

    function getUndoManager() {
        if (isMultipage()) {
            let currentPage = _pageManager.currentPage();
            if (_undoManager === null) {
                _undoManager = {};
            }
            if (!_undoManager.hasOwnProperty(currentPage)) {
                _undoManager[currentPage] = new wpd.UndoManager();
            }
            return _undoManager[currentPage];
        } else {
            if (_undoManager == null) {
                _undoManager = new wpd.UndoManager();
            }
            return _undoManager;
        }
    }

    function getMultipageUndoManager() {
        if (isMultipage()) {
            return _undoManager;
        }
        return null;
    }

    function setUndoManager(undoManager) {
        _undoManager = undoManager;
    }

    function getFileManager() {
        if (_fileManager == null) {
            _fileManager = new wpd.FileManager();
        }
        return _fileManager;
    }

    function getPageManager() {
        return _pageManager;
    }

    function setPageManager(pageManager) {
        _pageManager = pageManager;
        getFileManager().refreshPageInfo();
    }

    function isAligned() {
        return getPlotData().getAxesCount() > 0;
    }

    function isMultipage() {
        const pageManager = getPageManager();
        if (!pageManager) return false;
        return pageManager.pageCount() > 1;
    }

    function plotLoaded(imageData) {
        getPlotData().setTopColors(wpd.colorAnalyzer.getTopColors(imageData));
        getUndoManager().reapply();
    }

    return {
        isAligned: isAligned,
        isMultipage: isMultipage,
        getPlotData: getPlotData,
        getUndoManager: getUndoManager,
        getPageManager: getPageManager,
        getFileManager: getFileManager,
        getMultipageUndoManager: getMultipageUndoManager,
        setPageManager: setPageManager,
        setUndoManager: setUndoManager,
        reset: reset,
        plotLoaded: plotLoaded
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/
var wpd = wpd || {};
wpd.autoExtraction = (function() {
    function start() {
        wpd.colorPicker.init();
        wpd.algoManager.updateAlgoList();
    }

    return {
        start: start
    };
})();

// Manage auto extract algorithms
wpd.algoManager = (function() {
    var axes, dataset;

    function updateAlgoList() {

        dataset = wpd.tree.getActiveDataset();
        axes = wpd.appData.getPlotData().getAxesForDataset(dataset);

        let innerHTML = '';
        let $algoOptions = document.getElementById('auto-extract-algo-name');

        // Averaging Window
        if (!(axes instanceof wpd.BarAxes)) {
            innerHTML +=
                '<option value="averagingWindow">' + wpd.gettext('averaging-window') + '</option>';
        }

        // X Step w/ Interpolation and X Step
        if (axes instanceof wpd.XYAxes) {
            innerHTML += '<option value="XStepWithInterpolation">' +
                wpd.gettext('x-step-with-interpolation') + '</option>';
            innerHTML += '<option value="XStep">' + wpd.gettext('x-step') + '</option>';
        }

        // CustomIndependents
        if (axes instanceof wpd.XYAxes) {
            innerHTML += '<option value="CustomIndependents">' + wpd.gettext('custom-independents') + '</option>';
        }

        // Blob Detector
        if (!(axes instanceof wpd.BarAxes)) {
            innerHTML +=
                '<option value="blobDetector">' + wpd.gettext('blob-detector') + '</option>';
        }

        // Bar Extraction
        if (axes instanceof wpd.BarAxes) {
            innerHTML +=
                '<option value="barExtraction">' + wpd.gettext('bar-extraction') + '</option>';
        }

        // Histogram
        if (axes instanceof wpd.XYAxes) {
            innerHTML += '<option value="histogram">' + wpd.gettext('histogram') + '</option>';
        }

        $algoOptions.innerHTML = innerHTML;

        let autoDetector = getAutoDetectionData();
        if (autoDetector.algorithm != null) {
            if (autoDetector.algorithm instanceof wpd.AveragingWindowAlgo) {
                $algoOptions.value = "averagingWindow";
            } else if (autoDetector.algorithm instanceof wpd.XStepWithInterpolationAlgo) {
                $algoOptions.value = "XStepWithInterpolation";
            } else if (autoDetector.algorithm instanceof wpd.CustomIndependents) {
                $algoOptions.value = "CustomIndependents";
            } else if (autoDetector.algorithm instanceof wpd.AveragingWindowWithStepSizeAlgo) {
                $algoOptions.value = "XStep";
            } else if (autoDetector.algorithm instanceof wpd.BlobDetectorAlgo) {
                $algoOptions.value = "blobDetector";
            } else if (autoDetector.algorithm instanceof wpd.BarExtractionAlgo) {
                if (axes instanceof wpd.XYAxes) {
                    $algoOptions.value = "histogram";
                } else {
                    $algoOptions.value = "barExtraction";
                }
            }
            renderParameters(autoDetector.algorithm);
        } else {
            applyAlgoSelection();
        }
    }

    function getAutoDetectionData() {
        let ds = wpd.tree.getActiveDataset();
        return wpd.appData.getPlotData().getAutoDetectionDataForDataset(ds);
    }

    function applyAlgoSelection() {
        let $algoOptions = document.getElementById('auto-extract-algo-name');
        let selectedValue = $algoOptions.value;
        let autoDetector = getAutoDetectionData();

        if (selectedValue === 'averagingWindow') {
            autoDetector.algorithm = new wpd.AveragingWindowAlgo();
        } else if (selectedValue === 'XStepWithInterpolation') {
            autoDetector.algorithm = new wpd.XStepWithInterpolationAlgo();
        } else if (selectedValue === 'CustomIndependents') {
            autoDetector.algorithm = new wpd.CustomIndependents();
        } else if (selectedValue === 'XStep') {
            autoDetector.algorithm = new wpd.AveragingWindowWithStepSizeAlgo();
        } else if (selectedValue === 'blobDetector') {
            autoDetector.algorithm = new wpd.BlobDetectorAlgo();
        } else if (selectedValue === 'barExtraction' || selectedValue === 'histogram') {
            autoDetector.algorithm = new wpd.BarExtractionAlgo();
        } else {
            autoDetector.algorithm = new wpd.AveragingWindowAlgo();
        }

        renderParameters(autoDetector.algorithm);
    }

    function renderParameters(algo) {
        let $paramContainer = document.getElementById('algo-parameter-container');
        let algoParams = algo.getParamList(axes);
        let algoParamKeys = Object.keys(algoParams);
        let tableString = "<table>";

        for (let pi = 0; pi < algoParamKeys.length; pi++) {
            let algoParam = algoParams[algoParamKeys[pi]];
            tableString += '<tr><td>' + algoParam[0] +
                '</td><td><input type="text" size=3 id="algo-param-' + algoParamKeys[pi] +
                '" class="algo-params" value="' + algoParam[2] + '"/></td><td>' +
                algoParam[1] + '</td></tr>';
        }

        tableString += "</table>";
        $paramContainer.innerHTML = tableString;
    }

    function run() {
        wpd.busyNote.show();
        let autoDetector = getAutoDetectionData();
        let algo = autoDetector.algorithm;
        let repainter = new wpd.DataPointsRepainter(axes, dataset);
        let $paramFields = document.getElementsByClassName('algo-params');
        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();

        let algoParams = {};
        for (let pi = 0; pi < $paramFields.length; pi++) {
            let paramId = $paramFields[pi].id;
            let paramVar = paramId.replace('algo-param-', '');
            algoParams[paramVar] = $paramFields[pi].value;
        }
        algo.setParams(algoParams);

        wpd.graphicsWidget.removeTool();

        let imageData = ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        autoDetector.imageWidth = imageSize.width;
        autoDetector.imageHeight = imageSize.height;
        autoDetector.generateBinaryData(imageData);
        wpd.graphicsWidget.setRepainter(repainter);
        algo.run(autoDetector, dataset, axes);
        wpd.graphicsWidget.forceHandlerRepaint();
        wpd.dataPointCounter.setCount(dataset.getCount());
        wpd.busyNote.close();
        return true;
    }

    return {
        updateAlgoList: updateAlgoList,
        applyAlgoSelection: applyAlgoSelection,
        run: run
    };
})();

wpd.dataMask = (function() {
    function getAutoDetectionData() {
        let ds = wpd.tree.getActiveDataset();
        return wpd.appData.getPlotData().getAutoDetectionDataForDataset(ds);
    }

    function grabMask() {
        // Mask is just a list of pixels with the yellow color in the data layer
        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();
        let maskDataPx = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        let maskData = new Set();
        let autoDetector = getAutoDetectionData();

        for (let i = 0; i < maskDataPx.data.length; i += 4) {
            if (maskDataPx.data[i] === 255 && maskDataPx.data[i + 1] === 255 &&
                maskDataPx.data[i + 2] === 0) {
                maskData.add(i / 4);
            }
        }

        autoDetector.mask = maskData;
    }

    function markBox() {
        let tool = new wpd.BoxMaskTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function markPen() {
        let tool = new wpd.PenMaskTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function eraseMarks() {
        let tool = new wpd.EraseMaskTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function viewMask() {
        let tool = new wpd.ViewMaskTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function clearMask() {
        wpd.graphicsWidget.resetData();
        grabMask();
    }

    return {
        grabMask: grabMask,
        markBox: markBox,
        markPen: markPen,
        eraseMarks: eraseMarks,
        viewMask: viewMask,
        clearMask: clearMask
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.AxesCalibrator = class {
    constructor(calibration, isEditing) {
        this._calibration = calibration;
        this._isEditing = isEditing;
    }
};

wpd.XYAxesCalibrator = class extends wpd.AxesCalibrator {

    start() {
        wpd.popup.show('xyAxesInfo');
    }

    reload() {
        let tool = new wpd.AxesCornersTool(this._calibration, true);
        wpd.graphicsWidget.setTool(tool);
    }

    pickCorners() {
        wpd.popup.close('xyAxesInfo');
        let tool = new wpd.AxesCornersTool(this._calibration, false);
        wpd.graphicsWidget.setTool(tool);
    }

    getCornerValues() {
        wpd.popup.show('xyAlignment');
        if (this._isEditing) {
            let axes = wpd.tree.getActiveAxes();
            let prevCal = axes.calibration;
            if (prevCal.getCount() == 4) {
                document.getElementById('xmin').value = prevCal.getPoint(0).dx;
                document.getElementById('xmax').value = prevCal.getPoint(1).dx;
                document.getElementById('ymin').value = prevCal.getPoint(2).dy;
                document.getElementById('ymax').value = prevCal.getPoint(3).dy;
                document.getElementById('xlog').checked = axes.isLogX();
                document.getElementById('ylog').checked = axes.isLogY();
                document.getElementById('xy-axes-no-rotation').checked = axes.noRotation();
            }
        }
    }

    align() {
        let xmin = document.getElementById('xmin').value;
        let xmax = document.getElementById('xmax').value;
        let ymin = document.getElementById('ymin').value;
        let ymax = document.getElementById('ymax').value;
        let xlog = document.getElementById('xlog').checked;
        let ylog = document.getElementById('ylog').checked;
        let noRotation = document.getElementById('xy-axes-no-rotation').checked;
        let axes = this._isEditing ? wpd.tree.getActiveAxes() : new wpd.XYAxes();

        // validate log scale values
        if ((xlog && (parseFloat(xmin) == 0 || parseFloat(xmax) == 0)) ||
            (ylog && (parseFloat(ymin) == 0 || parseFloat(ymax) == 0))) {
            wpd.popup.close('xyAlignment');
            wpd.messagePopup.show(wpd.gettext('calibration-invalid-log-inputs'),
                wpd.gettext('calibration-enter-valid-log'),
                wpd.alignAxes.getCornerValues);
            return false;
        }

        this._calibration.setDataAt(0, xmin, ymin);
        this._calibration.setDataAt(1, xmax, ymin);
        this._calibration.setDataAt(2, xmin, ymin);
        this._calibration.setDataAt(3, xmax, ymax);
        if (!axes.calibrate(this._calibration, xlog, ylog, noRotation)) {
            wpd.popup.close('xyAlignment');
            wpd.messagePopup.show(wpd.gettext('calibration-invalid-inputs'),
                wpd.gettext('calibration-enter-valid'),
                wpd.alignAxes.getCornerValues);
            return false;
        }

        if (!this._isEditing) {
            axes.name = wpd.alignAxes.makeAxesName(wpd.XYAxes);
            let plot = wpd.appData.getPlotData();
            plot.addAxes(axes, wpd.appData.isMultipage());
            wpd.alignAxes.postProcessAxesAdd(axes);
        }
        wpd.popup.close('xyAlignment');
        return true;
    }
};

wpd.BarAxesCalibrator = class extends wpd.AxesCalibrator {
    start() {
        wpd.popup.show('barAxesInfo');
    }
    reload() {
        let tool = new wpd.AxesCornersTool(this._calibration, true);
        wpd.graphicsWidget.setTool(tool);
    }
    pickCorners() {
        wpd.popup.close('barAxesInfo');
        let tool = new wpd.AxesCornersTool(this._calibration, false);
        wpd.graphicsWidget.setTool(tool);
    }
    getCornerValues() {
        wpd.popup.show('barAlignment');
        if (this._isEditing) {
            let axes = wpd.tree.getActiveAxes();
            let prevCal = axes.calibration;
            if (prevCal.getCount() == 2) {
                document.getElementById('bar-axes-p1').value = prevCal.getPoint(0).dy;
                document.getElementById('bar-axes-p2').value = prevCal.getPoint(1).dy;
                document.getElementById('bar-axes-log-scale').checked = axes.isLog();
                document.getElementById('bar-axes-rotated').checked = axes.isRotated();
            }
        }
    }
    align() {
        let p1 = document.getElementById('bar-axes-p1').value;
        let p2 = document.getElementById('bar-axes-p2').value;
        let isLogScale = document.getElementById('bar-axes-log-scale').checked;
        let isRotated = document.getElementById('bar-axes-rotated').checked;
        let axes = this._isEditing ? wpd.tree.getActiveAxes() : new wpd.BarAxes();

        this._calibration.setDataAt(0, 0, p1);
        this._calibration.setDataAt(1, 0, p2);
        if (!axes.calibrate(this._calibration, isLogScale, isRotated)) {
            wpd.popup.close('barAlignment');
            wpd.messagePopup.show(wpd.gettext('calibration-invalid-inputs'),
                wpd.gettext('calibration-enter-valid'),
                wpd.alignAxes.getCornerValues);
            return false;
        }
        if (!this._isEditing) {
            axes.name = wpd.alignAxes.makeAxesName(wpd.BarAxes);
            let plot = wpd.appData.getPlotData();
            plot.addAxes(axes, wpd.appData.isMultipage());
            wpd.alignAxes.postProcessAxesAdd(axes);
        }
        wpd.popup.close('barAlignment');
        return true;
    }
};

wpd.PolarAxesCalibrator = class extends wpd.AxesCalibrator {

    start() {
        wpd.popup.show('polarAxesInfo');
    }
    reload() {
        let tool = new wpd.AxesCornersTool(this._calibration, true);
        wpd.graphicsWidget.setTool(tool);
    }
    pickCorners() {
        wpd.popup.close('polarAxesInfo');
        let tool = new wpd.AxesCornersTool(this._calibration, false);
        wpd.graphicsWidget.setTool(tool);
    }

    getCornerValues() {
        wpd.popup.show('polarAlignment');
        if (this._isEditing) {
            let axes = wpd.tree.getActiveAxes();
            let prevCal = axes.calibration;
            if (prevCal.getCount() == 3) {
                document.getElementById('polar-r1').value = prevCal.getPoint(1).dx;
                document.getElementById('polar-theta1').value = prevCal.getPoint(1).dy;
                document.getElementById('polar-r2').value = prevCal.getPoint(2).dx;
                document.getElementById('polar-theta2').value = prevCal.getPoint(2).dy;
                document.getElementById('polar-degrees').checked = axes.isThetaDegrees();
                document.getElementById('polar-radians').checked = !axes.isThetaDegrees();
                document.getElementById('polar-clockwise').checked = axes.isThetaClockwise();
                document.getElementById('polar-log-scale').checked = axes.isRadialLog();
            }
        }
    }

    align() {
        let r1 = parseFloat(document.getElementById('polar-r1').value);
        let theta1 = parseFloat(document.getElementById('polar-theta1').value);
        let r2 = parseFloat(document.getElementById('polar-r2').value);
        let theta2 = parseFloat(document.getElementById('polar-theta2').value);
        let degrees = document.getElementById('polar-degrees').checked;
        let orientation = document.getElementById('polar-clockwise').checked;
        let rlog = document.getElementById('polar-log-scale').checked;
        let axes = this._isEditing ? wpd.tree.getActiveAxes() : new wpd.PolarAxes();
        let isDegrees = degrees;

        this._calibration.setDataAt(1, r1, theta1);
        this._calibration.setDataAt(2, r2, theta2);
        axes.calibrate(this._calibration, isDegrees, orientation, rlog);
        if (!this._isEditing) {
            axes.name = wpd.alignAxes.makeAxesName(wpd.PolarAxes);
            let plot = wpd.appData.getPlotData();
            plot.addAxes(axes, wpd.appData.isMultipage());
            wpd.alignAxes.postProcessAxesAdd(axes);
        }
        wpd.popup.close('polarAlignment');
        return true;
    }
};

wpd.TernaryAxesCalibrator = class extends wpd.AxesCalibrator {

    start() {
        wpd.popup.show('ternaryAxesInfo');
    }

    reload() {
        let tool = new wpd.AxesCornersTool(this._calibration, true);
        wpd.graphicsWidget.setTool(tool);
    }

    pickCorners() {
        wpd.popup.close('ternaryAxesInfo');
        let tool = new wpd.AxesCornersTool(this._calibration, false);
        wpd.graphicsWidget.setTool(tool);
    }

    getCornerValues() {
        wpd.popup.show('ternaryAlignment');

        if (this._isEditing) {
            let axes = wpd.tree.getActiveAxes();
            let prevCal = axes.calibration;
            if (prevCal.getCount() == 3) {
                document.getElementById('range0to1').checked = !axes.isRange100();
                document.getElementById('range0to100').checked = axes.isRange100();
                document.getElementById('ternarynormal').checked = axes.isNormalOrientation();
            }
        }
    }

    align() {
        let range100 = document.getElementById('range0to100').checked;
        let ternaryNormal = document.getElementById('ternarynormal').checked;
        let axes = this._isEditing ? wpd.tree.getActiveAxes() : new wpd.TernaryAxes();

        axes.calibrate(this._calibration, range100, ternaryNormal);
        if (!this._isEditing) {
            axes.name = wpd.alignAxes.makeAxesName(wpd.TernaryAxes);
            let plot = wpd.appData.getPlotData();
            plot.addAxes(axes, wpd.appData.isMultipage());
            wpd.alignAxes.postProcessAxesAdd(axes);
        }
        wpd.popup.close('ternaryAlignment');
        return true;
    }
};

wpd.MapAxesCalibrator = class extends wpd.AxesCalibrator {

    start() {
        wpd.popup.show('mapAxesInfo');
    }
    reload() {
        let tool = new wpd.AxesCornersTool(this._calibration, true);
        wpd.graphicsWidget.setTool(tool);
    }
    pickCorners() {
        wpd.popup.close('mapAxesInfo');
        var tool = new wpd.AxesCornersTool(this._calibration, false);
        wpd.graphicsWidget.setTool(tool);
    }
    getCornerValues() {
        wpd.popup.show('mapAlignment');
        if (this._isEditing) {
            let axes = wpd.tree.getActiveAxes();
            let prevCal = axes.calibration;
            if (prevCal.getCount() == 2) {
                document.getElementById('scaleLength').checked = axes.getScaleLength();
                document.getElementById('scaleUnits').checked = axes.getUnits();
            }
        }
    }
    align() {
        let scaleLength = parseFloat(document.getElementById('scaleLength').value);
        let scaleUnits = document.getElementById('scaleUnits').value;
        let axes = this._isEditing ? wpd.tree.getActiveAxes() : new wpd.MapAxes();

        axes.calibrate(this._calibration, scaleLength, scaleUnits);
        if (!this._isEditing) {
            axes.name = wpd.alignAxes.makeAxesName(wpd.MapAxes);
            let plot = wpd.appData.getPlotData();
            plot.addAxes(axes, wpd.appData.isMultipage());
            wpd.alignAxes.postProcessAxesAdd(axes);
        }
        wpd.popup.close('mapAlignment');
        return true;
    }
};

wpd.alignAxes = (function() {
    let calibration = null;
    let calibrator = null;

    function initiatePlotAlignment() {
        let xyEl = document.getElementById('r_xy');
        let polarEl = document.getElementById('r_polar');
        let ternaryEl = document.getElementById('r_ternary');
        let mapEl = document.getElementById('r_map');
        let imageEl = document.getElementById('r_image');
        let barEl = document.getElementById('r_bar');

        wpd.popup.close('axesList');

        if (xyEl.checked === true) {
            calibration = new wpd.Calibration(2);
            calibration.labels = ['X1', 'X2', 'Y1', 'Y2'];
            calibration.labelPositions = ['N', 'N', 'E', 'E'];
            calibration.maxPointCount = 4;
            calibrator = new wpd.XYAxesCalibrator(calibration);
        } else if (barEl.checked === true) {
            calibration = new wpd.Calibration(2);
            calibration.labels = ['P1', 'P2'];
            calibration.labelPositions = ['S', 'S'];
            calibration.maxPointCount = 2;
            calibrator = new wpd.BarAxesCalibrator(calibration);
        } else if (polarEl.checked === true) {
            calibration = new wpd.Calibration(2);
            calibration.labels = ['Origin', 'P1', 'P2'];
            calibration.labelPositions = ['E', 'S', 'S'];
            calibration.maxPointCount = 3;
            calibrator = new wpd.PolarAxesCalibrator(calibration);
        } else if (ternaryEl.checked === true) {
            calibration = new wpd.Calibration(2);
            calibration.labels = ['A', 'B', 'C'];
            calibration.labelPositions = ['S', 'S', 'E'];
            calibration.maxPointCount = 3;
            calibrator = new wpd.TernaryAxesCalibrator(calibration);
        } else if (mapEl.checked === true) {
            calibration = new wpd.Calibration(2);
            calibration.labels = ['P1', 'P2'];
            calibration.labelPositions = ['S', 'S'];
            calibration.maxPointCount = 2;
            calibrator = new wpd.MapAxesCalibrator(calibration);
        } else if (imageEl.checked === true) {
            calibration = null;
            calibrator = null;
            var imageAxes = new wpd.ImageAxes();
            imageAxes.name = wpd.alignAxes.makeAxesName(wpd.ImageAxes);
            imageAxes.calibrate();
            wpd.appData.getPlotData().addAxes(imageAxes, wpd.appData.isMultipage());
            postProcessAxesAdd(imageAxes);
            wpd.tree.refresh();
            let dsNameColl = wpd.appData.getPlotData().getDatasetNames();
            if (dsNameColl.length > 0) {
                let dsName = dsNameColl[dsNameColl.length - 1];
                wpd.tree.selectPath("/" + wpd.gettext("datasets") + "/" + dsName, true);
            }
            wpd.acquireData.load();
        }

        if (calibrator != null) {
            calibrator.start();
            wpd.graphicsWidget.setRepainter(new wpd.AlignmentCornersRepainter(calibration));
        }
    }

    function calibrationCompleted() {
        wpd.sidebar.show('axes-calibration-sidebar');
    }

    function zoomCalPoint(i) {
        var point = calibration.getPoint(i);
        wpd.graphicsWidget.updateZoomToImagePosn(point.px, point.py);
    }

    function getCornerValues() {
        calibrator.getCornerValues();
    }

    function pickCorners() {
        calibrator.pickCorners();
    }

    function align() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.removeRepainter();
        wpd.graphicsWidget.resetData();
        if (!calibrator.align()) {
            return;
        }
        wpd.sidebar.clear();
        wpd.tree.refresh();
        let dsNameColl = wpd.appData.getPlotData().getDatasetNames();
        if (dsNameColl.length > 0) {
            let dsName = dsNameColl[0];
            wpd.tree.selectPath("/" + wpd.gettext("datasets") + "/" + dsName);
        }
    }

    function editAlignment() {
        let hasAlignment = wpd.appData.isAligned() && calibrator != null;
        if (hasAlignment) {
            wpd.popup.show('edit-or-reset-calibration-popup');
        } else {
            wpd.popup.show('axesList');
        }
    }

    function addCalibration() {
        wpd.popup.show("axesList");
    }

    function reloadCalibrationForEditing() {
        wpd.popup.close('edit-or-reset-calibration-popup');
        calibrator = null;
        const axes = wpd.tree.getActiveAxes();
        calibration = axes.calibration;
        if (axes instanceof wpd.XYAxes) {
            calibrator = new wpd.XYAxesCalibrator(calibration, true);
        } else if (axes instanceof wpd.BarAxes) {
            calibrator = new wpd.BarAxesCalibrator(calibration, true);
        } else if (axes instanceof wpd.PolarAxes) {
            calibrator = new wpd.PolarAxesCalibrator(calibration, true);
        } else if (axes instanceof wpd.TernaryAxes) {
            calibrator = new wpd.TernaryAxesCalibrator(calibration, true);
        } else if (axes instanceof wpd.MapAxes) {
            calibrator = new wpd.MapAxesCalibrator(calibration, true);
        }
        if (calibrator == null)
            return;
        calibrator.reload();
        wpd.graphicsWidget.setRepainter(new wpd.AlignmentCornersRepainter(calibration));
        wpd.graphicsWidget.forceHandlerRepaint();
        wpd.sidebar.show('axes-calibration-sidebar');
    }

    function deleteCalibration() {
        wpd.okCancelPopup.show(wpd.gettext("delete-axes"), wpd.gettext("delete-axes-text"),
            function() {
                const plotData = wpd.appData.getPlotData();
                const axes = wpd.tree.getActiveAxes();
                plotData.deleteAxes(axes);
                if (wpd.appData.isMultipage()) {
                    wpd.appData.getPageManager().deleteAxesFromCurrentPage([axes]);
                }
                wpd.tree.refresh();
                wpd.tree.selectPath("/" + wpd.gettext("axes"));
                // dispatch axes delete event
                wpd.events.dispatch("wpd.axes.delete", {
                    axes: axes
                });
            });
    }

    function showRenameAxes() {
        const axes = wpd.tree.getActiveAxes();
        const $axName = document.getElementById("rename-axes-name-input");
        $axName.value = axes.name;
        wpd.popup.show('rename-axes-popup');
    }

    function renameAxes() {
        const $axName = document.getElementById("rename-axes-name-input");
        wpd.popup.close('rename-axes-popup');
        // check if this name already exists
        const name = $axName.value.trim();
        const plotData = wpd.appData.getPlotData();
        if (plotData.getAxesNames().indexOf(name) >= 0 || name.length === 0) {
            wpd.messagePopup.show(wpd.gettext("rename-axes-error"),
                wpd.gettext("axes-exists-error"), showRenameAxes);
            return;
        }
        const axes = wpd.tree.getActiveAxes();
        axes.name = name;
        wpd.tree.refresh();
        wpd.tree.selectPath("/" + wpd.gettext("axes") + "/" + name, true);
    }

    function renameKeypress(e) {
        if (e.key === "Enter") {
            renameAxes();
        }
    }

    function makeAxesName(axType) {
        const plotData = wpd.appData.getPlotData();
        let name = "";
        const existingAxesNames = plotData.getAxesNames();
        if (axType === wpd.XYAxes) {
            name = wpd.gettext("axes-name-xy");
        } else if (axType === wpd.PolarAxes) {
            name = wpd.gettext("axes-name-polar");
        } else if (axType === wpd.MapAxes) {
            name = wpd.gettext("axes-name-map");
        } else if (axType === wpd.TernaryAxes) {
            name = wpd.gettext("axes-name-ternary");
        } else if (axType === wpd.BarAxes) {
            name = wpd.gettext("axes-name-bar");
        } else if (axType === wpd.ImageAxes) {
            name = wpd.gettext("axes-name-image");
        }
        // avoid conflict with an existing name
        let idx = 2;
        let fullName = name;
        while (existingAxesNames.indexOf(fullName) >= 0) {
            fullName = name + " " + idx;
            idx++;
        }
        return fullName;
    }

    function postProcessAxesAdd(axes) {
        // dispatch axes add event
        wpd.events.dispatch("wpd.axes.add", {
            axes: axes
        });

        const plotData = wpd.appData.getPlotData();
        const fileManager = wpd.appData.getFileManager();
        const pageManager = wpd.appData.getPageManager();

        fileManager.addAxesToCurrentFile([axes]);

        let axesColl = fileManager.filterToCurrentFileAxes(plotData.getAxesColl());
        let datasetColl = fileManager.filterToCurrentFileDatasets(plotData.getDatasets());

        if (wpd.appData.isMultipage()) {
            pageManager.addAxesToCurrentPage([axes]);
            axesColl = pageManager.filterToCurrentPageAxes(axesColl);
            datasetColl = pageManager.filterToCurrentPageDatasets(datasetColl);
        }

        // create a default dataset and associate it with the axes if this is the first
        // axes (in the file and/or page) and datasets do not yet exist
        if (axesColl.length === 1 && datasetColl.length === 0) {
            let dataset = new wpd.Dataset();
            dataset.name = 'Default Dataset';
            const count = wpd.dataSeriesManagement.getDatasetWithNameCount(dataset.name);
            if (count > 0) dataset.name += ' ' + (count + 1);

            plotData.addDataset(dataset);
            fileManager.addDatasetsToCurrentFile([dataset]);

            if (wpd.appData.isMultipage()) {
                pageManager.addDatasetsToCurrentPage([dataset]);
            }

            // dispatch dataset add event
            wpd.events.dispatch("wpd.dataset.add", {
                dataset: dataset
            });
        }
    }

    return {
        start: initiatePlotAlignment,
        calibrationCompleted: calibrationCompleted,
        zoomCalPoint: zoomCalPoint,
        getCornerValues: getCornerValues,
        pickCorners: pickCorners,
        align: align,
        editAlignment: editAlignment,
        reloadCalibrationForEditing: reloadCalibrationForEditing,
        addCalibration: addCalibration,
        deleteCalibration: deleteCalibration,
        showRenameAxes: showRenameAxes,
        makeAxesName: makeAxesName,
        renameAxes: renameAxes,
        renameKeypress: renameKeypress,
        postProcessAxesAdd: postProcessAxesAdd
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

// browserInfo.js - browser and available HTML5 feature detection
var wpd = wpd || {};
wpd.browserInfo = (function() {
    function checkBrowser() {
        if (!window.FileReader || typeof WebAssembly !== "object" || !("download" in document.createElement("a"))) {
            alert(
                'WARNING!\nYour web browser may not be fully supported. Please use a recent version of Google Chrome, Firefox or Safari browser with HTML5 and WebAssembly support.');
        }
    }

    function isElectronBrowser() {
        if (typeof process === 'undefined') { // there's probably a much better way to do this!
            return false;
        }
        return true;
    }

    return {
        checkBrowser: checkBrowser,
        isElectronBrowser: isElectronBrowser
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.colorSelectionWidget = (function() {
    var color, triggerElementId, title, setColorDelegate;

    function setParams(params) {
        color = params.color;
        triggerElementId = params.triggerElementId;
        title = params.title;
        setColorDelegate = params.setColorDelegate;

        let $widgetTitle = document.getElementById('color-selection-title');
        $widgetTitle.innerHTML = title;
    }

    function apply() {
        let $triggerBtn = document.getElementById(triggerElementId);
        $triggerBtn.style.backgroundColor =
            'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        if (color[0] + color[1] + color[2] < 200) {
            $triggerBtn.style.color = 'rgb(255,255,255)';
        } else {
            $triggerBtn.style.color = 'rgb(0,0,0)';
        }
    }

    function startPicker() {
        let $selectedColor = document.getElementById('color-selection-selected-color-box');

        $selectedColor.style.backgroundColor =
            'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        document.getElementById('color-selection-red').value = color[0];
        document.getElementById('color-selection-green').value = color[1];
        document.getElementById('color-selection-blue').value = color[2];
        renderColorOptions();
        wpd.popup.show('color-selection-widget');
    }

    function renderColorOptions() {
        let $container = document.getElementById('color-selection-options');
        let topColors = wpd.appData.getPlotData().getTopColors();
        let colorCount = topColors.length > 10 ? 10 : topColors.length;
        let containerHtml = "";

        for (let colori = 0; colori < colorCount; colori++) {
            let colorString = 'rgb(' + topColors[colori].r + ',' + topColors[colori].g + ',' +
                topColors[colori].b + ');';
            let perc = topColors[colori].percentage.toFixed(3) + "%";
            containerHtml += '<div class="colorOptionBox" style="background-color: ' + colorString +
                '\" title=\"' + perc +
                '" onclick="wpd.colorSelectionWidget.selectTopColor(' + colori +
                ');"></div>';
        }

        $container.innerHTML = containerHtml;
    }

    function pickColor() {
        wpd.popup.close('color-selection-widget');
        let tool = new wpd.ColorPickerTool();
        tool.onComplete = function(col) {
            color = col;
            setColorDelegate(col);
            wpd.graphicsWidget.removeTool();
            startPicker();
        };
        wpd.graphicsWidget.setTool(tool);
    }

    function setColor() {
        let gui_color = [];
        gui_color[0] = parseInt(document.getElementById('color-selection-red').value, 10);
        gui_color[1] = parseInt(document.getElementById('color-selection-green').value, 10);
        gui_color[2] = parseInt(document.getElementById('color-selection-blue').value, 10);
        color = gui_color;
        setColorDelegate(gui_color);
        wpd.popup.close('color-selection-widget');
        apply();
    }

    function selectTopColor(colorIndex) {
        let gui_color = [];
        let topColors = wpd.appData.getPlotData().getTopColors();

        gui_color[0] = topColors[colorIndex].r;
        gui_color[1] = topColors[colorIndex].g;
        gui_color[2] = topColors[colorIndex].b;

        color = gui_color;
        setColorDelegate(gui_color);
        startPicker();
    }

    function paintFilteredColor(binaryData, maskPixels) {
        let ctx = wpd.graphicsWidget.getAllContexts();
        const imageSize = wpd.graphicsWidget.getImageSize();
        let dataLayer = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);

        if (maskPixels == null || maskPixels.size === 0) {
            return;
        }

        for (let img_index of maskPixels) {

            if (binaryData.has(img_index)) {
                dataLayer.data[img_index * 4] = 255;
                dataLayer.data[img_index * 4 + 1] = 255;
                dataLayer.data[img_index * 4 + 2] = 0;
                dataLayer.data[img_index * 4 + 3] = 255;
            } else {
                dataLayer.data[img_index * 4] = 0;
                dataLayer.data[img_index * 4 + 1] = 0;
                dataLayer.data[img_index * 4 + 2] = 0;
                dataLayer.data[img_index * 4 + 3] = 150;
            }
        }

        ctx.oriDataCtx.putImageData(dataLayer, 0, 0);
        wpd.graphicsWidget.copyImageDataLayerToScreen();
    }

    return {
        setParams: setParams,
        startPicker: startPicker,
        pickColor: pickColor,
        setColor: setColor,
        selectTopColor: selectTopColor,
        paintFilteredColor: paintFilteredColor
    };
})();

wpd.colorPicker = (function() {
    function getAutoDetectionData() {
        let ds = wpd.tree.getActiveDataset();
        return wpd.appData.getPlotData().getAutoDetectionDataForDataset(ds);
    }

    function getFGPickerParams() {
        let ad = getAutoDetectionData();
        return {
            color: ad.fgColor,
            triggerElementId: 'color-button',
            title: wpd.gettext('specify-foreground-color'),
            setColorDelegate: function(col) {
                ad.fgColor = col;
            }
        };
    }

    function getBGPickerParams() {
        let ad = getAutoDetectionData();
        return {
            color: ad.bgColor,
            triggerElementId: 'color-button',
            title: wpd.gettext('specify-background-color'),
            setColorDelegate: function(col) {
                ad.bgColor = col;
            }
        };
    }

    function init() {
        let $colorBtn = document.getElementById('color-button');
        let $colorDistance = document.getElementById('color-distance-value');
        let autoDetector = getAutoDetectionData();
        let $modeSelector = document.getElementById('color-detection-mode-select');
        let color = null;

        if (autoDetector.colorDetectionMode === 'fg') {
            color = autoDetector.fgColor;
        } else {
            color = autoDetector.bgColor;
        }
        let color_distance = autoDetector.colorDistance;

        $colorBtn.style.backgroundColor = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        $colorDistance.value = color_distance;
        $modeSelector.value = autoDetector.colorDetectionMode;
    }

    function changeColorDistance() {
        let color_distance = parseFloat(document.getElementById('color-distance-value').value);
        getAutoDetectionData().colorDistance = color_distance;
    }

    function testColorDetection() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        wpd.graphicsWidget.setRepainter(new wpd.ColorFilterRepainter());

        let ctx = wpd.graphicsWidget.getAllContexts();
        let autoDetector = getAutoDetectionData();
        let imageSize = wpd.graphicsWidget.getImageSize();

        let imageData = ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        autoDetector.generateBinaryData(imageData);
        wpd.colorSelectionWidget.paintFilteredColor(autoDetector.binaryData, autoDetector.mask);
    }

    function startPicker() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.removeRepainter();
        wpd.graphicsWidget.resetData();
        if (getAutoDetectionData().colorDetectionMode === 'fg') {
            wpd.colorSelectionWidget.setParams(getFGPickerParams());
        } else {
            wpd.colorSelectionWidget.setParams(getBGPickerParams());
        }
        wpd.colorSelectionWidget.startPicker();
    }

    function changeDetectionMode() {
        let $modeSelector = document.getElementById('color-detection-mode-select');
        getAutoDetectionData().colorDetectionMode = $modeSelector.value;
        init();
    }

    return {
        startPicker: startPicker,
        changeDetectionMode: changeDetectionMode,
        changeColorDistance: changeColorDistance,
        init: init,
        testColorDetection: testColorDetection
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.dataSeriesManagement = (function() {
    function datasetWithNameExists(name) {
        const plotData = wpd.appData.getPlotData();
        const dsNameColl = plotData.getDatasetNames();
        if (dsNameColl.indexOf(name) >= 0) {
            return true;
        }
        return false;
    }

    function getDatasetWithNameCount(name) {
        const plotData = wpd.appData.getPlotData();
        const dsNameColl = plotData.getDatasetNames();
        let counter = 0;
        for (const dsName of dsNameColl) {
            if (dsName.startsWith(name)) {
                counter++;
            }
        }
        return counter;
    }

    function getDatasetCount() {
        const plotData = wpd.appData.getPlotData();
        return plotData.getDatasetCount();
    }

    function showAddDataset() {
        const $singleDatasetName = document.getElementById('add-single-dataset-name-input');
        let suffix = getDatasetCount();
        let dsName = wpd.gettext("dataset") + " " + suffix;
        while (datasetWithNameExists(dsName)) {
            suffix++;
            dsName = wpd.gettext("dataset") + " " + suffix;
        }
        $singleDatasetName.value = dsName;
        wpd.popup.show('add-dataset-popup');
    }

    function showRenameDataset() {
        const ds = wpd.tree.getActiveDataset();
        const $dsName = document.getElementById('rename-dataset-name-input');
        $dsName.value = ds.name;
        wpd.popup.show('rename-dataset-popup');
    }

    function renameDataset() {
        const $dsName = document.getElementById('rename-dataset-name-input');
        wpd.popup.close('rename-dataset-popup');

        if (datasetWithNameExists($dsName.value.trim())) {
            wpd.messagePopup.show(wpd.gettext("rename-dataset-error"),
                wpd.gettext("dataset-exists-error"), showRenameDataset);
            return;
        }
        const ds = wpd.tree.getActiveDataset();
        ds.name = $dsName.value.trim();
        wpd.tree.refresh();
        wpd.tree.selectPath("/" + wpd.gettext("datasets") + "/" + ds.name, true);
    }

    function renameKeypress(e) {
        if (e.key === "Enter") {
            renameDataset();
        }
    }

    function addSingleDataset() {
        const $singleDatasetName = document.getElementById('add-single-dataset-name-input');

        wpd.popup.close('add-dataset-popup');

        // do not add if this name already exists
        if (datasetWithNameExists($singleDatasetName.value.trim())) {
            wpd.messagePopup.show(wpd.gettext("add-dataset-error"),
                wpd.gettext("dataset-exists-error"),
                function() {
                    wpd.popup.show('add-dataset-popup');
                });
            return;
        }

        const plotData = wpd.appData.getPlotData();
        let ds = new wpd.Dataset();
        ds.name = $singleDatasetName.value.trim();
        plotData.addDataset(ds);
        wpd.appData.getFileManager().addDatasetsToCurrentFile([ds]);
        if (wpd.appData.isMultipage()) {
            wpd.appData.getPageManager().addDatasetsToCurrentPage([ds]);
        }
        wpd.tree.refreshPreservingSelection();
        // dispatch dataset add event
        wpd.events.dispatch("wpd.dataset.add", {
            dataset: ds
        });
    }

    function addMultipleDatasets() {
        const $dsCount = document.getElementById('add-multiple-datasets-count-input');
        const dsCount = parseInt($dsCount.value, 0);
        wpd.popup.close('add-dataset-popup');
        if (dsCount > 0) {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            const isMultipage = wpd.appData.isMultipage();
            let idx = getDatasetCount();
            const prefix = wpd.gettext("dataset") + " ";
            let i = 0;
            while (i < dsCount) {
                let dsName = prefix + idx;
                if (!datasetWithNameExists(dsName)) {
                    let ds = new wpd.Dataset();
                    ds.name = dsName;
                    plotData.addDataset(ds);
                    fileManager.addDatasetsToCurrentFile([ds]);
                    if (isMultipage) {
                        wpd.appData.getPageManager().addDatasetsToCurrentPage([ds]);
                    }
                    // dispatch dataset add event
                    wpd.events.dispatch("wpd.dataset.add", {
                        dataset: ds
                    });
                    i++;
                }
                idx++;
            }
            wpd.tree.refreshPreservingSelection();
        } else {
            wpd.messagePopup(wpd.gettext("add-dataset-error"),
                wpd.gettext("add-dataset-count-error"),
                function() {
                    wpd.popup.show('add-dataset-popup');
                });
        }
    }

    function deleteDataset() {
        wpd.okCancelPopup.show(wpd.gettext("delete-dataset"), wpd.gettext("delete-dataset-text"),
            function() {
                const plotData = wpd.appData.getPlotData();
                const ds = wpd.tree.getActiveDataset();
                plotData.deleteDataset(ds);
                wpd.appData.getFileManager().deleteDatasetsFromCurrentFile([ds]);
                if (wpd.appData.isMultipage()) {
                    wpd.appData.getPageManager().deleteDatasetsFromCurrentPage([ds]);
                }
                wpd.tree.refresh();
                wpd.tree.selectPath("/" + wpd.gettext("datasets"));
                // dispatch dataset delete event
                wpd.events.dispatch("wpd.dataset.delete", {
                    dataset: ds
                });
            });
    }

    function changeAxes(axIdx) {
        const plotData = wpd.appData.getPlotData();
        const axesColl = plotData.getAxesColl();
        const ds = wpd.tree.getActiveDataset();
        axIdx = parseInt(axIdx, 10);
        if (axIdx === -1) {
            plotData.setAxesForDataset(ds, null);
        } else if (axIdx >= 0 && axIdx < axesColl.length) {
            plotData.setAxesForDataset(ds, axesColl[axIdx]);
        }
        wpd.tree.refreshPreservingSelection(true);
    }

    function startColorPicker() {
        wpd.colorSelectionWidget.setParams({
            color: wpd.tree.getActiveDataset().colorRGB.getRGB(),
            triggerElementId: 'dataset-display-color-picker-button',
            title: 'Specify Display Color for Digitized Points',
            setColorDelegate: function(col) {
                wpd.tree.getActiveDataset().colorRGB = new wpd.Color(col[0], col[1], col[2]);
                wpd.graphicsWidget.forceHandlerRepaint();
                wpd.tree.refreshPreservingSelection();
            }
        });
        wpd.colorSelectionWidget.startPicker();
    }

    return {
        showAddDataset: showAddDataset,
        showRenameDataset: showRenameDataset,
        renameDataset: renameDataset,
        renameKeypress: renameKeypress,
        addSingleDataset: addSingleDataset,
        addMultipleDatasets: addMultipleDatasets,
        deleteDataset: deleteDataset,
        changeAxes: changeAxes,
        startColorPicker: startColorPicker,
        getDatasetWithNameCount: getDatasetWithNameCount
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.FileManager = class {
    constructor() {
        this.$pageInfoElements = document.getElementsByClassName('paged');
        this.$fileSelectorContainers = document.getElementsByClassName('files');
        this.$navSeparator = document.getElementById('navSeparator');
        this.$fileSelector = document.getElementById('image-file-select');
        this._init();
    }

    _init() {
        this.currentIndex = 0;
        this.pageManagers = {};
        this.undoManagers = {};
        this.axesByFile = {};
        this.datasetsByFile = {};
        this.measurementsByFile = {};
        this.files = [];
        this.$navSeparator.hidden = true;
        this._hidePageInfo();
    }

    set(files) {
        this.files = files;
        this._initializeInput();
        if (files.length > 1) {
            this._showFileInfo();
        } else {
            this._hideFileInfo();
            this.$navSeparator.hidden = true;
        }
    }

    reset() {
        this._init();
        wpd.appData.setPageManager(null);
    }

    getFiles() {
        return this.files;
    }

    fileCount() {
        return this.files.length;
    }

    currentFileIndex() {
        return this.currentIndex;
    }

    _initializeInput() {
        const labels = Array.prototype.map.call(this.files, file => file.name);
        const values = wpd.utils.integerRange(this.files.length);
        const selected = this.currentIndex;
        this.$fileSelector.innerHTML = wpd.utils.createOptionsHTML(labels, values, selected);
    }

    _showFileInfo() {
        wpd.utils.toggleElementsDisplay(this.$fileSelectorContainers, false);
    }

    _hideFileInfo() {
        wpd.utils.toggleElementsDisplay(this.$fileSelectorContainers, true);
    }

    _showPageInfo() {
        wpd.utils.toggleElementsDisplay(this.$pageInfoElements, false);
    }

    _hidePageInfo() {
        wpd.utils.toggleElementsDisplay(this.$pageInfoElements, true);
    }

    // controlling the display logic for page related elements here so it can
    // be managed after file change
    refreshPageInfo() {
        if (wpd.appData.isMultipage()) {
            this._showPageInfo();
            if (this.files.length > 1) {
                this.$navSeparator.hidden = false;
            }
        } else {
            this._hidePageInfo();
            this.$navSeparator.hidden = true;
        }
    }

    _savePageManager() {
        const pageManager = wpd.appData.getPageManager();
        if (pageManager && !this.pageManagers[this.currentIndex]) {
            this.pageManagers[this.currentIndex] = pageManager;
        }
    }

    _loadPageManager(index) {
        let pageManager = null;
        if (this.pageManagers[index]) {
            pageManager = this.pageManagers[index];
            pageManager.refreshInput();
        }
        wpd.appData.setPageManager(pageManager);
    }

    _saveUndoManager() {
        let undoManager = null;

        // checks for empty undo managers; if so don't save them to avoid unnecessary
        // use of memory
        if (this.pageManagers[this.currentIndex]) {
            undoManager = wpd.appData.getMultipageUndoManager();
        } else {
            undoManager = wpd.appData.getUndoManager();
            // if cannot undo and cannot redo, we assume it's empty
            if (!undoManager.canUndo() && !undoManager.canRedo()) {
                undoManager = null;
            }
        }

        if (undoManager) {
            this.undoManagers[this.currentIndex] = undoManager;
        }
    }

    _loadUndoManager(index) {
        let undoManager = null;
        if (this.undoManagers[index]) {
            undoManager = this.undoManagers[index];
        }
        wpd.appData.setUndoManager(undoManager);
    }

    switch (index) {
        const newIndex = parseInt(index, 10);
        if (newIndex !== this.currentIndex && newIndex > -1 && newIndex <= this.files.length) {
            // save page manager
            this._savePageManager();

            // load or clear page manager
            this._loadPageManager(newIndex);

            // save undo manager
            this._saveUndoManager();

            // load or clear undo manager
            this._loadUndoManager(newIndex);

            // load the file
            wpd.imageManager.loadFromFile(this.files[newIndex], true);

            // update current file index
            this.currentIndex = newIndex;

            // refresh the tree
            wpd.tree.refresh();
        }
    }

    addAxesToCurrentFile(axes) {
        wpd.utils.addToCollection(this.axesByFile, this.currentIndex, axes);
    }

    addDatasetsToCurrentFile(datasets) {
        wpd.utils.addToCollection(this.datasetsByFile, this.currentIndex, datasets);
    }

    addMeasurementsToCurrentFile(measurements) {
        wpd.utils.addToCollection(this.measurementsByFile, this.currentIndex, measurements);
    }

    deleteDatasetsFromCurrentFile(datasets) {
        wpd.utils.deleteFromCollection(this.datasetsByFile, this.currentIndex, datasets);
    }

    deleteMeasurementsFromCurrentFile(measurements) {
        wpd.utils.deleteFromCollection(this.measurementsByFile, this.currentIndex, measurements);
    }

    getAxesNameMap() {
        return wpd.utils.invertObject(this.axesByFile);
    }

    getDatasetNameMap() {
        return wpd.utils.invertObject(this.datasetsByFile);
    }

    filterToCurrentFileAxes(axes) {
        return wpd.utils.filterCollection(this.axesByFile, this.currentIndex, axes);
    }

    filterToCurrentFileDatasets(datasets) {
        return wpd.utils.filterCollection(this.datasetsByFile, this.currentIndex, datasets);
    }

    filterToCurrentFileMeasurements(measurements) {
        return wpd.utils.filterCollection(this.measurementsByFile, this.currentIndex, measurements);
    }

    // for use with saving wpd json
    getMetadata() {
        const metadata = {};

        const allMeasurements = wpd.appData.getPlotData().getMeasurementColl();

        // save the latest page manager, in case it hasn't been saved
        this._savePageManager();

        // only include file metadata if there is more than 1 file
        if (this.fileCount() > 1) {
            metadata.file = {
                axes: this.getAxesNameMap(),
                datasets: this.getDatasetNameMap(),
                measurements: allMeasurements.map(ms => wpd.utils.findKey(this.measurementsByFile, ms))
            };
        }

        // only include page and pageLabel metadata if there are page managers saved in the file manager
        if (Object.keys(this.pageManagers).length > 0) {
            // setting axes name maps and dataset name maps to start with an empty object
            // for ease of calling Object.assign later
            let axesNameMaps = [{}];
            let datasetNameMaps = [{}];
            let measurementPageMaps = []; // measurements do not have unique names
            let pageLabelMaps = {};

            // collect metadata from all page managers
            for (const index in this.pageManagers) {
                axesNameMaps.push(this.pageManagers[index].getAxesNameMap());
                datasetNameMaps.push(this.pageManagers[index].getDatasetNameMap());
                measurementPageMaps.push(this.pageManagers[index].getMeasurementPageMap());
                const pageLabelMap = this.pageManagers[index].getPageLabelMap();
                if (Object.keys(pageLabelMap).length) {
                    pageLabelMaps[index] = pageLabelMap;
                }
            }

            metadata.page = {
                axes: Object.assign.apply(null, axesNameMaps),
                datasets: Object.assign.apply(null, datasetNameMaps),
                measurements: allMeasurements.map(ms => {
                    for (const measurementPageMap of measurementPageMaps) {
                        const foundPage = wpd.utils.findKey(measurementPageMap, ms);
                        if (foundPage) {
                            return foundPage;
                        }
                    }
                })
            };

            if (Object.keys(pageLabelMaps).length) {
                // include page label maps by file in the miscellaneous category
                metadata.misc = {
                    pageLabel: pageLabelMaps
                };
            }
        }

        return metadata;
    }

    // for use when loading wpd json
    loadMetadata(metadata) {
        let fileManager = this;

        // load file metadata
        if (metadata.file) {
            fileManager.axesByFile = metadata.file.axes || {};
            fileManager.datasetsByFile = metadata.file.datasets || {};
            fileManager.measurementsByFile = metadata.file.measurements || {};
        } else {
            // if there does not exist file indexes, assume there is only one file and
            // associate all data collections with the only file
            fileManager.axesByFile['0'] = wpd.appData.getPlotData().getAxesColl().slice();
            fileManager.datasetsByFile['0'] = wpd.appData.getPlotData().getDatasets().slice();
            fileManager.measurementsByFile['0'] = wpd.appData.getPlotData().getMeasurementColl().slice();
        }

        let files = [];
        for (let index = 0; index < fileManager.files.length; index++) {
            let filePromise = null
            if (fileManager.files[index].type === 'application/pdf') {
                // if the first file is a pdf, it has already been loaded with a page manager
                // save the page manager
                if (index === 0) {
                    fileManager._savePageManager();
                } else {
                    filePromise = new Promise((resolve, reject) => {
                        let reader = new FileReader();
                        reader.onload = function() {
                            pdfjsLib.getDocument(reader.result).promise.then(pdf => resolve(pdf));
                        };
                        reader.readAsDataURL(this.files[index]);
                    });
                }
            }
            files.push(filePromise);
        }

        return Promise.all(files).then(files => {
            for (let index = 0; index < files.length; index++) {
                let pageData = {};

                // only supporting pages in pdf files for now, this should include tiff files
                // in the future
                if (fileManager.files[index].type === 'application/pdf') {
                    if (files[index] !== null) {
                        // initialize page managers
                        fileManager.pageManagers[index] = wpd.imageManager.initializePDFManager(
                            files[index],
                            true
                        );
                    }

                    // load page metadata
                    if (metadata.page) {
                        let pageAxes = {};
                        let pageDatasets = {};
                        let pageMeasurements = {};

                        for (const page in metadata.page.axes) {
                            pageAxes[page] = metadata.page.axes[page].filter(ax => {
                                return fileManager.axesByFile[index] &&
                                    fileManager.axesByFile[index].indexOf(ax) > -1;
                            });
                        }
                        for (const page in metadata.page.datasets) {
                            pageDatasets[page] = metadata.page.datasets[page].filter(ds => {
                                return fileManager.datasetsByFile[index] &&
                                    fileManager.datasetsByFile[index].indexOf(ds) > -1;
                            });
                        }
                        for (const page in metadata.page.measurements) {
                            pageMeasurements[page] = metadata.page.measurements[page].filter(ms => {
                                return fileManager.measurementsByFile[index] &&
                                    fileManager.measurementsByFile[index].indexOf(ms) > -1;
                            });
                        }

                        Object.assign(pageData, {
                            axes: pageAxes,
                            datasets: pageDatasets,
                            measurements: pageMeasurements
                        });
                    }
                }

                // load miscellaneous metadata
                if (metadata.misc) {
                    // load page labels
                    if (metadata.misc.pageLabel) {
                        if (fileManager.pageManagers.hasOwnProperty(index)) {
                            Object.assign(pageData, {
                                pageLabels: metadata.misc.pageLabel[index]
                            });
                        }
                    }
                }

                // load page data into page manager
                if (fileManager.pageManagers.hasOwnProperty(index)) {
                    if (Object.keys(pageData).length) {
                        fileManager.pageManagers[index].loadPageData(pageData);
                    }

                    // refresh the page select input for the first file
                    if (index === 0) {
                        fileManager.pageManagers[index].refreshInput();
                    }
                }
            }
            wpd.tree.refresh();
        });
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.gridDetection = (function() {
    function start() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.removeRepainter();
        wpd.graphicsWidget.resetData();
        wpd.sidebar.show('grid-detection-sidebar');
        sidebarInit();
    }

    function sidebarInit() {
        let $colorPickerBtn = document.getElementById('grid-color-picker-button');
        let $backgroundMode = document.getElementById('grid-background-mode');
        let autodetector = wpd.appData.getPlotData().getGridDetectionData();
        let color = autodetector.lineColor;
        let backgroundMode = autodetector.gridBackgroundMode;

        if (color != null) {
            $colorPickerBtn.style.backgroundColor =
                'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
            if (color[0] + color[1] + color[2] < 200) {
                $colorPickerBtn.style.color = 'rgb(255,255,255)';
            } else {
                $colorPickerBtn.style.color = 'rgb(0,0,0)';
            }
        }

        $backgroundMode.checked = backgroundMode;
    }

    function markBox() {
        let tool = new wpd.GridBoxTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function viewMask() {
        let tool = new wpd.GridViewMaskTool();
        wpd.graphicsWidget.setTool(tool);
    }

    function clearMask() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.removeRepainter();
        wpd.appData.getPlotData().getGridDetectionData().gridMask = {
            xmin: null,
            xmax: null,
            ymin: null,
            ymax: null,
            pixels: new Set()
        };
        wpd.graphicsWidget.resetData();
    }

    function grabMask() {
        // Mask is just a list of pixels with the yellow color in the data layer
        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();
        let maskDataPx = ctx.oriDataCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        let maskData = new Set();
        let mi = 0;
        let autoDetector = wpd.appData.getPlotData().getGridDetectionData();

        for (let i = 0; i < maskDataPx.data.length; i += 4) {
            if (maskDataPx.data[i] === 255 && maskDataPx.data[i + 1] === 255 &&
                maskDataPx.data[i + 2] === 0) {

                maskData.add(i / 4);
                mi++;

                let x = parseInt((i / 4) % imageSize.width, 10);
                let y = parseInt((i / 4) / imageSize.width, 10);

                if (mi === 1) {
                    autoDetector.gridMask.xmin = x;
                    autoDetector.gridMask.xmax = x;
                    autoDetector.gridMask.ymin = y;
                    autoDetector.gridMask.ymax = y;
                } else {
                    if (x < autoDetector.gridMask.xmin) {
                        autoDetector.gridMask.xmin = x;
                    }
                    if (x > autoDetector.gridMask.xmax) {
                        autoDetector.gridMask.xmax = x;
                    }
                    if (y < autoDetector.gridMask.ymin) {
                        autoDetector.gridMask.ymin = y;
                    }
                    if (y > autoDetector.gridMask.ymax) {
                        autoDetector.gridMask.ymax = y;
                    }
                }
            }
        }
        autoDetector.gridMask.pixels = maskData;
    }

    function run() {

        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.removeRepainter();
        wpd.graphicsWidget.resetData();

        // For now, just reset before detecting, otherwise users will get confused:
        reset();

        let autoDetector = wpd.appData.getPlotData().getGridDetectionData();
        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();
        let $xperc = document.getElementById('grid-horiz-perc');
        let $yperc = document.getElementById('grid-vert-perc');
        let horizEnable = document.getElementById('grid-horiz-enable').checked;
        let vertEnable = document.getElementById('grid-vert-enable').checked;
        let backgroundMode = document.getElementById('grid-background-mode').checked;
        let plotData = wpd.appData.getPlotData();

        if (autoDetector.backupImageData == null) {
            autoDetector.backupImageData =
                ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        }

        let imageData = ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);

        autoDetector.generateBinaryData(imageData);

        // gather detection parameters from GUI

        wpd.gridDetectionCore.setHorizontalParameters(horizEnable, $xperc.value);
        wpd.gridDetectionCore.setVerticalParameters(vertEnable, $yperc.value);
        autoDetector.gridData = wpd.gridDetectionCore.run(autoDetector);

        // edit image
        wpd.graphicsWidget.runImageOp(removeGridLinesOp);

        // cleanup memory
        wpd.appData.getPlotData().getGridDetectionData().gridData = null;
    }

    function resetImageOp(idata, width, height) {
        let bkImg = wpd.appData.getPlotData().getGridDetectionData().backupImageData;

        for (let i = 0; i < bkImg.data.length; i++) {
            idata.data[i] = bkImg.data[i];
        }

        return {
            imageData: idata,
            width: width,
            height: height,
            keepZoom: true
        };
    }

    function reset() {
        wpd.graphicsWidget.removeTool();
        wpd.appData.getPlotData().getGridDetectionData().gridData = null;
        wpd.graphicsWidget.removeRepainter();
        wpd.graphicsWidget.resetData();

        let plotData = wpd.appData.getPlotData();
        if (plotData.getGridDetectionData().backupImageData != null) {
            wpd.graphicsWidget.runImageOp(resetImageOp);
        }
    }

    function removeGridLinesOp(idata, width, height) {
        /* image op to remove grid lines */
        let gridData = wpd.appData.getPlotData().getGridDetectionData().gridData;
        let bgColor = wpd.appData.getPlotData().getTopColors()[0];

        if (bgColor == null) {
            bgColor = {
                r: 255,
                g: 0,
                b: 0
            };
        }

        if (gridData != null) {
            for (let rowi = 0; rowi < height; rowi++) {
                for (let coli = 0; coli < width; coli++) {
                    let pindex = 4 * (rowi * width + coli);
                    if (gridData.has(pindex / 4)) {
                        idata.data[pindex] = bgColor.r;
                        idata.data[pindex + 1] = bgColor.g;
                        idata.data[pindex + 2] = bgColor.b;
                        idata.data[pindex + 3] = 255;
                    }
                }
            }
        }

        return {
            imageData: idata,
            width: width,
            height: height
        };
    }

    function startColorPicker() {
        wpd.colorSelectionWidget.setParams({
            color: wpd.appData.getPlotData().getGridDetectionData().lineColor,
            triggerElementId: 'grid-color-picker-button',
            title: 'Specify Grid Line Color',
            setColorDelegate: function(
                col) {
                wpd.appData.getPlotData().getGridDetectionData().lineColor = col;
            }
        });
        wpd.colorSelectionWidget.startPicker();
    }

    function testColor() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        wpd.graphicsWidget.setRepainter(new wpd.GridColorFilterRepainter());

        let autoDetector = wpd.appData.getPlotData().getGridDetectionData();

        changeColorDistance();

        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();
        let imageData = ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);
        autoDetector.generateBinaryData(imageData);

        wpd.colorSelectionWidget.paintFilteredColor(autoDetector.binaryData,
            autoDetector.gridMask.pixels);
    }

    function changeColorDistance() {
        let color_distance = parseFloat(document.getElementById('grid-color-distance').value);
        wpd.appData.getPlotData().getGridDetectionData().colorDistance = color_distance;
    }

    function changeBackgroundMode() {
        let backgroundMode = document.getElementById('grid-background-mode').checked;
        wpd.appData.getPlotData().getGridDetectionData().gridBackgroundMode = backgroundMode;
    }

    return {
        start: start,
        markBox: markBox,
        clearMask: clearMask,
        viewMask: viewMask,
        grabMask: grabMask,
        startColorPicker: startColorPicker,
        changeColorDistance: changeColorDistance,
        changeBackgroundMode: changeBackgroundMode,
        testColor: testColor,
        run: run,
        reset: reset
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.gettext = function(stringId) {
    let $str = document.getElementById('i18n-string-' + stringId);
    if ($str) {
        return $str.innerHTML;
    }
    return 'i18n string';
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.imageEditing = {
    showImageInfo: function() {
        let $imageDimensions = document.getElementById('image-info-dimensions');
        let imageInfo = wpd.imageManager.getImageInfo();
        $imageDimensions.innerHTML = '(' + imageInfo.width + 'x' + imageInfo.height + ')';

        if (wpd.appData.isMultipage()) {
            let $imagePages = document.getElementById('image-info-pages');
            $imagePages.innerHTML = wpd.appData.getPageManager().pageCount();
        }
        wpd.popup.show('image-info-popup');
    },

    startImageCrop: function() {
        wpd.graphicsWidget.setTool(new wpd.CropTool());
    },

    startPerspective: function() {
        wpd.popup.show('perspective-info');
    },

    startPerspectiveConfirmed: function() {

    },

    undo: function() {
        wpd.appData.getUndoManager().undo();
    },

    redo: function() {
        wpd.appData.getUndoManager().redo();
    }
};

wpd.ReversibleAction = class {
    constructor() {}
    execute() {}
    undo() {}
};

wpd.CropImageAction = class extends wpd.ReversibleAction {
    constructor(x0, y0, x1, y1) {
        super();
        this._x0 = x0;
        this._y0 = y0;
        this._x1 = x1;
        this._y1 = y1;
        this._originalImage = null;
    }

    execute() {
        // store current image for undo
        let ctx = wpd.graphicsWidget.getAllContexts();
        let imageSize = wpd.graphicsWidget.getImageSize();
        this._originalImage = ctx.oriImageCtx.getImageData(0, 0, imageSize.width, imageSize.height);

        // crop image
        let croppedImage = ctx.oriImageCtx.getImageData(this._x0, this._y0, this._x1, this._y1);
        let croppedWidth = this._x1 - this._x0;
        let croppedHeight = this._y1 - this._y0;

        // replace current image with cropped image
        let imageOp = function(imageData, width, height) {
            return {
                imageData: croppedImage,
                width: croppedWidth,
                height: croppedHeight,
                keepZoom: true
            };
        };

        wpd.graphicsWidget.runImageOp(imageOp);
    }

    undo() {
        // set the saved image
        let originalImage = this._originalImage;
        let imageOp = function(imageData, width, height) {
            return {
                imageData: originalImage,
                width: originalImage.width,
                height: originalImage.height
            };
        };

        // call all dependent UI elements
        wpd.graphicsWidget.runImageOp(imageOp);
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.imageManager = (function() {
    let _firstLoad = true;
    let _newLoad = false;
    let _imageInfo = {
        width: 0,
        height: 0
    };

    function saveImage() {
        wpd.graphicsWidget.saveImage();
    }

    function load() {
        let $input = document.getElementById('fileLoadBox');
        if ($input.files.length > 0) {
            _newLoad = true;
            initializeFileManager($input.files);
            wpd.appData.setPageManager(null);
            loadFromFile($input.files[0]);
        }
        wpd.popup.close('loadNewImage');
    }

    function loadFromFile(imageFile, resumedProject) {
        return new Promise((resolve, reject) => {
            if (imageFile.type.match("image.*")) {
                wpd.busyNote.show();
                let reader = new FileReader();
                reader.onload = function() {
                    let url = reader.result;
                    loadFromURL(url, resumedProject).then(resolve);
                };
                reader.readAsDataURL(imageFile);
            } else if (imageFile.type == "application/pdf") {
                wpd.busyNote.show();
                let reader = new FileReader();
                reader.onload = function() {
                    let pdfurl = reader.result;
                    pdfjsLib.getDocument(pdfurl).promise.then(function(pdf) {
                        const existingPageManager = wpd.appData.getPageManager();
                        if (existingPageManager) {
                            existingPageManager.renderPage(existingPageManager.currentPage(),
                                resumedProject).then(resolve);
                        } else {
                            const pdfManager = initializePDFManager(pdf);
                            pdfManager.renderPage(1, resumedProject).then(resolve);
                            wpd.appData.setPageManager(pdfManager);
                        }
                    });
                };
                reader.readAsDataURL(imageFile);
            } else {
                console.log(imageFile.type);
                wpd.messagePopup.show(wpd.gettext('invalid-file'),
                    wpd.gettext('invalid-file-text'));
            }
        });
    }

    function loadFromURL(url, resumedProject) {
        return new Promise((resolve, reject) => {
            let image = new Image();
            image.onload = function() {
                _setImage(image, resumedProject);
                resolve();
            };
            image.src = url;
        });
    }

    function _setImage(image, resumedProject) {
        if (_newLoad) {
            wpd.appData.reset();
            wpd.sidebar.clear();
        }
        let imageData = wpd.graphicsWidget.loadImage(image);
        wpd.appData.plotLoaded(imageData);
        wpd.busyNote.close();
        if (_newLoad) {
            wpd.tree.refresh();
        } else {
            wpd.tree.refreshPreservingSelection();
        }
        if (_firstLoad) {
            wpd.sidebar.show('start-sidebar');
        } else if (!resumedProject) {
            wpd.popup.show('axesList');
        }
        _firstLoad = false;
        _newLoad = false;
        _imageInfo = {
            width: imageData.width,
            height: imageData.height
        };
    }

    function getImageInfo() {
        return _imageInfo;
    }

    function initializeFileManager(files) {
        const fileManager = wpd.appData.getFileManager();
        fileManager.reset();
        fileManager.set(files);
    }

    function initializePDFManager(pdf, skipInputRefresh) {
        const pdfManager = new wpd.PDFManager();
        pdfManager.init(pdf, skipInputRefresh);
        return pdfManager;
    }

    return {
        saveImage: saveImage,
        loadFromURL: loadFromURL,
        loadFromFile: loadFromFile,
        load: load,
        getImageInfo: getImageInfo,
        initializeFileManager: initializeFileManager,
        initializePDFManager: initializePDFManager
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};
wpd.acquireData = (function() {
    var dataset, axes;

    function load() {
        dataset = getActiveDataset();
        axes = getAxes();

        if (axes == null) {
            wpd.messagePopup.show(wpd.gettext('dataset-no-calibration'),
                wpd.gettext('calibrate-dataset'));
        } else {
            wpd.graphicsWidget.removeTool();
            wpd.graphicsWidget.resetData();
            showSidebar();
            wpd.autoExtraction.start();
            wpd.dataPointCounter.setCount();
            wpd.graphicsWidget.removeTool();
            wpd.graphicsWidget.setRepainter(new wpd.DataPointsRepainter(axes, dataset));

            manualSelection();

            wpd.graphicsWidget.forceHandlerRepaint();
            wpd.dataPointCounter.setCount(dataset.getCount());
        }
    }

    function getActiveDataset() {
        return wpd.tree.getActiveDataset();
    }

    function getAxes() {
        return wpd.appData.getPlotData().getAxesForDataset(getActiveDataset());
    }

    function manualSelection() {
        var tool = new wpd.ManualSelectionTool(axes, dataset);
        wpd.graphicsWidget.setTool(tool);
    }

    function deletePoint() {
        var tool = new wpd.DeleteDataPointTool(axes, dataset);
        wpd.graphicsWidget.setTool(tool);
    }

    function confirmedClearAll() {
        dataset.clearAll();
        wpd.pointGroups.hideControls();
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        wpd.dataPointCounter.setCount(dataset.getCount());
        wpd.graphicsWidget.removeRepainter();
    }

    function clearAll() {
        if (dataset.getCount() <= 0 && !dataset.hasPointGroups()) {
            return;
        }
        wpd.okCancelPopup.show(wpd.gettext('clear-data-points'),
            wpd.gettext('clear-data-points-text'), confirmedClearAll,
            function() {});
    }

    function undo() {
        dataset.removeLastPixel();
        wpd.graphicsWidget.resetData();
        wpd.graphicsWidget.forceHandlerRepaint();
        wpd.dataPointCounter.setCount(dataset.getCount());
    }

    function showSidebar() {
        wpd.sidebar.show('acquireDataSidebar');
        updateControlVisibility();
        wpd.dataPointCounter.setCount(dataset.getCount());
    }

    function updateControlVisibility() {
        var $editLabelsBtn = document.getElementById('edit-data-labels');
        if (axes instanceof wpd.BarAxes) {
            $editLabelsBtn.style.display = 'inline-block';
        } else {
            $editLabelsBtn.style.display = 'none';
        }
    }

    function adjustPoints() {
        wpd.graphicsWidget.setTool(new wpd.AdjustDataPointTool(axes, dataset));
    }

    function editLabels() {
        // this should only trigger the tool if the axes type is bar
        if (axes instanceof wpd.BarAxes) {
            wpd.graphicsWidget.setTool(new wpd.EditLabelsTool(axes, dataset));
        }
    }

    function switchToolOnKeyPress(alphaKey) {
        switch (alphaKey) {
            case 'd':
                deletePoint();
                break;
            case 'a':
                manualSelection();
                break;
            case 's':
                adjustPoints();
                break;
            case 'e':
                editLabels();
                break;
            default:
                break;
        }
    }

    function isToolSwitchKey(keyCode) {
        if (wpd.keyCodes.isAlphabet(keyCode, 'a') || wpd.keyCodes.isAlphabet(keyCode, 's') ||
            wpd.keyCodes.isAlphabet(keyCode, 'd') || wpd.keyCodes.isAlphabet(keyCode, 'e')) {
            return true;
        }
        return false;
    }

    return {
        load: load,
        manualSelection: manualSelection,
        adjustPoints: adjustPoints,
        deletePoint: deletePoint,
        clearAll: clearAll,
        undo: undo,
        showSidebar: showSidebar,
        switchToolOnKeyPress: switchToolOnKeyPress,
        isToolSwitchKey: isToolSwitchKey,
        editLabels: editLabels
    };
})();

wpd.dataPointLabelEditor = (function() {
    var ds, ptIndex, tool;

    function show(dataset, pointIndex, initTool) {
        const pixel = dataset.getPixel(pointIndex),
            originalLabel = pixel.metadata.label;

        ds = dataset;
        ptIndex = pointIndex;
        tool = initTool;

        wpd.graphicsWidget.removeTool();

        // show popup window with originalLabel in the input field.
        wpd.popup.show('data-point-label-editor');
        const $labelField = document.getElementById('data-point-label-field');
        $labelField.value = originalLabel;
        $labelField.focus();
    }

    function ok() {
        var newLabel = document.getElementById('data-point-label-field').value;

        if (newLabel != null && newLabel.length > 0) {
            // fetch metadata and override values
            const pixel = ds.getPixel(ptIndex);
            let metadata = {};
            if (pixel.metadata != null) {
                metadata = pixel.metadata;
            }

            metadata.label = newLabel;

            // set label
            ds.setMetadataAt(ptIndex, metadata);

            // refresh graphics
            wpd.graphicsWidget.resetData();
            wpd.graphicsWidget.forceHandlerRepaint();
        }

        wpd.popup.close('data-point-label-editor');
        wpd.graphicsWidget.setTool(tool);
    }

    function cancel() {
        // just close the popup
        wpd.popup.close('data-point-label-editor');
        wpd.graphicsWidget.setTool(tool);
    }

    function keydown(ev) {
        if (wpd.keyCodes.isEnter(ev.keyCode)) {
            ok();
        } else if (wpd.keyCodes.isEsc(ev.keyCode)) {
            cancel();
        }
        ev.stopPropagation();
    }

    return {
        show: show,
        ok: ok,
        cancel: cancel,
        keydown: keydown
    };
})();

wpd.dataPointValueOverrideEditor = (function() {
    let ds, ax, axLabels, ptIndexes, tool;

    const editorID = 'data-point-value-override-editor';
    const tableID = 'data-point-value-override-editor-table';
    const resetFlagID = 'data-point-value-override-revert-flag';

    const labelBaseID = 'data-point-value-override-field-label-';
    const fieldBaseID = 'data-point-value-override-field-';
    const indicatorBaseID = 'data-point-value-override-indicator-';

    const multiplePointsSelectedMessage = 'Multiple points selected';
    const multipleOverridesExistMessage = 'Multiple override values';
    const someOverridesExistMessage = 'Some values overridden';

    function _init(dataset, axes, pointIndexes, initTool) {
        ds = dataset;
        ax = axes;
        ptIndexes = pointIndexes;
        tool = initTool;

        // filter out bar chart "Label" axis
        axLabels = axes.getAxesLabels()
            .map(label => label.toLowerCase())
            .filter(label => label !== 'label');

        // generate the table row HTML using axes labels to label input fields
        document.getElementById(tableID).innerHTML = _getTableRowsHTML();

        // avoid handler collisions
        wpd.graphicsWidget.removeTool();

        // reselect point, display tool mask, and repaint to keep displaying the selected point
        dataset.selectPixels(pointIndexes);
        initTool.displayMask();
        wpd.graphicsWidget.forceHandlerRepaint();

        // bind keydown listener so esc key closes the popup properly
        window.addEventListener('keydown', keydown, false);
    }

    function _getTableRowsHTML() {
        let html = '';

        axLabels.forEach(label => {
            let displayLabel = wpd.utils.toSentenceCase(label);

            // display "Value" instead of "Y" for bar chart values
            if (ax instanceof wpd.BarAxes && label === 'y') {
                displayLabel = wpd.utils.toSentenceCase('value');
            }

            html += '<tr>';

            // row label
            html += '<td>';
            html += '<span id="' + labelBaseID + label + '">';
            html += displayLabel + '</span>:';
            html += '</td>';

            // row input
            html += '<td>';
            html += '<input type="text" id="' + fieldBaseID + label + '"';
            html += ' onkeydown="wpd.dataPointValueOverrideEditor.keydown(event);" />';
            html += '</td>';

            // row overridden indicator
            html += '<td>';
            html += '<span id="' + indicatorBaseID + label + '"';
            html += ' hidden>&#8682;</span>';
            html += '</td>';

            html += '</tr>';
        });

        return html;
    }

    function show(dataset, axes, pointIndexes, initTool) {
        // initialize popup
        _init(dataset, axes, pointIndexes, initTool);

        // show popup window
        wpd.popup.show(editorID);

        const displayValues = {};

        // variables for checking if each value on points have been overridden
        // and if all override values for each field are the same across all
        // selected points
        const isAllOverridden = {};
        const isSomeOverridden = {};
        const overrideValuesByField = {};

        // initialize information collection variables
        axLabels.forEach(label => {
            isAllOverridden[label] = true;
            isSomeOverridden[label] = false;
            overrideValuesByField[label] = [];
        });

        // go through each selected point and collect values for display
        pointIndexes.forEach(index => {
            const pixel = dataset.getPixel(index);
            const originals = _getDataFromPixel(pixel);

            // if metadata on the pixel exists, display saved override values
            // if not, display current values
            let overrides = {};
            if (pixel.metadata != null && pixel.metadata.hasOwnProperty('overrides')) {
                overrides = pixel.metadata.overrides;
            }

            // for each original calculated value, if there exists an override, display
            // the override value instead of the original value
            axLabels.forEach(label => {
                if (!overrides.hasOwnProperty(label)) {
                    // no override value, use original calculated value
                    displayValues[label] = originals[label];

                    isAllOverridden[label] = false;
                } else {
                    // override value exists, use override value
                    displayValues[label] = overrides[label];

                    overrideValuesByField[label].push(overrides[label]);

                    isSomeOverridden[label] = true;
                }
            });
        });

        // for each field: set display values, show/hide overridden icons,
        // and display appropriate placeholder text if applicable
        axLabels.forEach(label => {
            const $field = document.getElementById(fieldBaseID + label);
            const $overriddenIndicator = document.getElementById(indicatorBaseID + label);

            if (isSomeOverridden[label]) {
                if (isAllOverridden[label]) {
                    // check if all overridden values are the same
                    const hasSameValue = (value) => value === overrideValuesByField[label][0];

                    if (overrideValuesByField[label].every(hasSameValue)) {
                        // get the first set of values in displayValues if all overrides
                        // are the same value
                        $field.value = displayValues[label];
                    } else {
                        $field.placeholder = multipleOverridesExistMessage;
                    }
                } else {
                    $field.placeholder = someOverridesExistMessage;
                }

                // display value overridden indicator
                $overriddenIndicator.hidden = false;
            } else {
                // single point
                if (pointIndexes.length === 1) {
                    $field.value = displayValues[label];
                } else {
                    // none overridden, clear inputs
                    $field.placeholder = multiplePointsSelectedMessage;
                }

                // hide value overridden indicator
                $overriddenIndicator.hidden = true;
            }
        });
    }

    function ok() {
        // process each selected point
        ptIndexes.forEach(index => {
            if (!_isReset()) {
                // fetch original values by converting pixel coordinates to values
                const pixel = ds.getPixel(index);
                const originals = _getDataFromPixel(pixel);

                // fetch metadata and override values
                let metadata = {};
                let overrides = {};
                if (pixel.metadata != null) {
                    metadata = pixel.metadata;

                    if (pixel.metadata.hasOwnProperty('overrides')) {
                        overrides = metadata.overrides;
                    }
                }

                const metadataKeys = ds.getMetadataKeys();

                const newOverrides = {};
                let hasChanges = false;

                // fetch and process each input field values
                axLabels.forEach(label => {
                    let newValue = document.getElementById(fieldBaseID + label).value;

                    // given value differs from the original calculated value
                    if (originals[label] != newValue) {
                        // given value is not null and has length
                        if (newValue != null && newValue.length > 0) {
                            hasChanges = true;

                            // convert numeric strings to float
                            if (!isNaN(newValue)) {
                                newValue = parseFloat(newValue);
                            }

                            // collect given value
                            newOverrides[label] = newValue;

                            // set overrides metadata keys for dataset if not been set
                            if (metadataKeys.indexOf('overrides') < 0) {
                                ds.setMetadataKeys([...metadataKeys, 'overrides']);
                            }
                        } else {
                            if (overrides.hasOwnProperty(label)) {
                                hasChanges = true;

                                // preserve previous override value if it exists
                                newOverrides[label] = overrides[label];
                            }
                        }
                    }
                });

                // if any value is overridden, set the metadata
                if (hasChanges) {
                    metadata.overrides = newOverrides;

                    // set value
                    ds.setMetadataAt(index, metadata);

                    // refresh graphics
                    wpd.graphicsWidget.resetData();
                } else {
                    _resetMetadataAt(index);
                }
            } else {
                // if reset flag is set, skip the checks and remove metadata on
                // selected points
                _resetMetadataAt(index);
            }
        });

        _closePopup();
    }

    function cancel() {
        _closePopup();
    }

    function keydown(ev) {
        if (wpd.keyCodes.isEnter(ev.keyCode)) {
            ok();
        } else if (wpd.keyCodes.isEsc(ev.keyCode)) {
            cancel();
        }
        ev.stopPropagation();
    }

    function clear() {
        // set reset flag
        _toggleResetFlag(true);

        // process each selected point
        ptIndexes.forEach(index => {
            // convert pixel coordinates to values
            const originals = _getDataFromPixel(ds.getPixel(index));

            // process each field
            axLabels.forEach(label => {
                let $field = document.getElementById(fieldBaseID + label);
                let value;

                // different behavior when multiple points are selected
                if (ptIndexes.length > 1) {
                    value = '';
                    $field.placeholder = multiplePointsSelectedMessage;
                } else {
                    value = originals[label];
                }

                // reset input fields
                document.getElementById(fieldBaseID + label).value = value;

                // hide override indicators
                document.getElementById(indicatorBaseID + label).hidden = true;
            });
        });
    }

    function _getDataFromPixel(pixel) {
        // convert pixel data array into object keyed by axes labels
        // dependent on ordering of labels
        return ax.pixelToData(pixel.x, pixel.y).reduce((object, value, index) => {
            return {
                ...object,
                [axLabels[index]]: value
            };
        }, {});
    }

    function _resetMetadataAt(index) {
        // set the metadata to undefined, effectively removing it
        let newMetadata = undefined;

        if (ax instanceof wpd.BarAxes) {
            // preserve label information if this is a bar chart
            newMetadata = ds.getPixel(index).metadata;

            delete newMetadata.overrides;

            // check if there are any overrides
            const hasOverrides = ds.getAllPixels().some(pixel => {
                if (pixel.metadata && pixel.metadata.hasOwnProperty('overrides')) {
                    return true;
                }
                return false;
            });

            // no overrides left, remove overrides metadata key
            if (!hasOverrides) {
                ds.setMetadataKeys(ds.getMetadataKeys().filter(key => key !== 'overrides'));
            }
        } else {
            // remove metadata keys on the dataset if all have been removed
            if (!ds.hasMetadata()) {
                ds.setMetadataKeys([]);
            }
        }

        ds.setMetadataAt(index, newMetadata);
    }

    function _closePopup() {
        // clear reset flag
        _toggleResetFlag(false);

        // remove popup keydown listener
        window.removeEventListener("keydown", keydown, false);

        wpd.popup.close(editorID);
        wpd.graphicsWidget.setTool(tool);
        tool.toggleOverrideSection(ptIndexes);
        wpd.graphicsWidget.forceHandlerRepaint();
    }

    function _toggleResetFlag(enable) {
        let value = '0';

        if (enable) {
            value = '1';
        }

        document.getElementById(resetFlagID).value = value;
    }

    function _isReset() {
        return document.getElementById(resetFlagID).value === '1';
    }

    return {
        show: show,
        ok: ok,
        cancel: cancel,
        keydown: keydown,
        clear: clear
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.measurementModes = {
    distance: {
        name: 'distance',
        connectivity: 2,
        addButtonId: 'add-pair-button',
        deleteButtonId: 'delete-pair-button',
        sidebarId: 'measure-distances-sidebar',
        init: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            const distMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.DistanceMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                if (pageManager.filterToCurrentPageMeasurements(distMeasures).length == 0) {
                    const distMeasure = new wpd.DistanceMeasurement();
                    const pageAxes = pageManager.getCurrentPageAxes();
                    if (pageAxes.length > 0) {
                        for (let i = pageAxes.length - 1; i > -1; i--) {
                            if (
                                pageAxes[i] instanceof wpd.MapAxes ||
                                pageAxes[i] instanceof wpd.ImageAxes
                            ) {
                                plotData.setAxesForMeasurement(distMeasure, pageAxes[i]);
                                break;
                            }
                        }
                    }
                    plotData.addMeasurement(distMeasure, true);
                    fileManager.addMeasurementsToCurrentFile([distMeasure]);
                    pageManager.addMeasurementsToCurrentPage([distMeasure]);
                }
            } else {
                if (distMeasures.length == 0) {
                    const distMeasure = new wpd.DistanceMeasurement();
                    plotData.addMeasurement(distMeasure);
                    fileManager.addMeasurementsToCurrentFile([distMeasure]);
                }
            }
        },
        clear: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            let distMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.DistanceMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                distMeasures = pageManager.filterToCurrentPageMeasurements(distMeasures);
                pageManager.deleteMeasurementsFromCurrentPage(distMeasures);
            }
            fileManager.deleteMeasurementsFromCurrentFile(distMeasures);
            distMeasures.forEach(m => {
                m.clearAll();
            });
            plotData.deleteMeasurement(distMeasures[0]);
            wpd.tree.refresh();
        },
        getData: function() {
            const plotData = wpd.appData.getPlotData();
            let distMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.DistanceMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                distMeasures = pageManager.filterToCurrentPageMeasurements(distMeasures);
            }
            return distMeasures[0];
        },
        getAxes: function() {
            const plotData = wpd.appData.getPlotData();
            let distMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.DistanceMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                distMeasures = pageManager.filterToCurrentPageMeasurements(distMeasures);
            }
            return plotData.getAxesForMeasurement(distMeasures[0]);
        },
        changeAxes: function(axIdx) {
            const plotData = wpd.appData.getPlotData();
            let distMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.DistanceMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                distMeasures = pageManager.filterToCurrentPageMeasurements(distMeasures);
            }
            let distMeasure = distMeasures[0];
            let axesColl = plotData.getAxesColl();
            if (axIdx == -1) {
                plotData.setAxesForMeasurement(distMeasure, null);
            } else {
                plotData.setAxesForMeasurement(distMeasure, axesColl[axIdx]);
            }
            wpd.tree.refreshPreservingSelection(true);
        }
    },
    angle: {
        name: 'angle',
        connectivity: 3,
        addButtonId: 'add-angle-button',
        deleteButtonId: 'delete-angle-button',
        sidebarId: 'measure-angles-sidebar',
        init: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            const angleMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AngleMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                if (pageManager.filterToCurrentPageMeasurements(angleMeasures).length == 0) {
                    const angleMeasure = new wpd.AngleMeasurement();
                    plotData.addMeasurement(angleMeasure, true);
                    fileManager.addMeasurementsToCurrentFile([angleMeasure]);
                    pageManager.addMeasurementsToCurrentPage([angleMeasure]);
                }
            } else {
                if (angleMeasures.length == 0) {
                    const angleMeasure = new wpd.AngleMeasurement();
                    plotData.addMeasurement(angleMeasure);
                    fileManager.addMeasurementsToCurrentFile([angleMeasure]);
                }
            }
        },
        clear: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            let angleMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AngleMeasurement)
            );
            fileManager.deleteMeasurementsFromCurrentFile(angleMeasures);
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                angleMeasures = pageManager.filterToCurrentPageMeasurements(angleMeasures);
                pageManager.deleteMeasurementsFromCurrentPage(angleMeasures);
            }
            angleMeasures.forEach(m => {
                m.clearAll();
            });
            plotData.deleteMeasurement(angleMeasures[0]);
            wpd.tree.refresh();
        },
        getData: function() {
            let plotData = wpd.appData.getPlotData();
            let angleMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AngleMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                angleMeasures = pageManager.filterToCurrentPageMeasurements(angleMeasures);
            }
            return angleMeasures[0];
        }
    },
    area: {
        name: 'area',
        connectivity: -1,
        addButtonId: 'add-polygon-button',
        deleteButtonId: 'delete-polygon-button',
        sidebarId: 'measure-area-sidebar',
        init: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            let areaMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AreaMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
                if (areaMeasures.length == 0) {
                    const areaMeasure = new wpd.AreaMeasurement();
                    plotData.addMeasurement(areaMeasure, true);
                    fileManager.addMeasurementsToCurrentFile([areaMeasure]);
                    pageManager.addMeasurementsToCurrentPage([areaMeasure]);
                }
            } else {
                if (areaMeasures.length == 0) {
                    const areaMeasure = new wpd.AreaMeasurement();
                    plotData.addMeasurement(areaMeasure);
                    fileManager.addMeasurementsToCurrentFile([areaMeasure]);
                }
            }
        },
        clear: function() {
            const plotData = wpd.appData.getPlotData();
            const fileManager = wpd.appData.getFileManager();
            let areaMeasures = fileManager.filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AreaMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
                pageManager.deleteMeasurementsFromCurrentPage(areaMeasures);
            }
            fileManager.deleteMeasurementsFromCurrentFile(areaMeasures);
            areaMeasures.forEach(m => {
                m.clearAll();
            });
            plotData.deleteMeasurement(areaMeasures[0]);
            wpd.tree.refresh();
        },
        getData: function() {
            const plotData = wpd.appData.getPlotData();
            let areaMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AreaMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
            }
            return areaMeasures[0];
        },
        getAxes: function() {
            const plotData = wpd.appData.getPlotData();
            let areaMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AreaMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
            }
            return plotData.getAxesForMeasurement(areaMeasures[0]);
        },
        changeAxes: function(axIdx) {
            const plotData = wpd.appData.getPlotData();
            let areaMeasures = wpd.appData.getFileManager().filterToCurrentFileMeasurements(
                plotData.getMeasurementsByType(wpd.AreaMeasurement)
            );
            if (wpd.appData.isMultipage()) {
                const pageManager = wpd.appData.getPageManager();
                areaMeasures = pageManager.filterToCurrentPageMeasurements(areaMeasures);
            }
            let areaMeasure = areaMeasures[0];
            let axesColl = plotData.getAxesColl();
            if (axIdx == -1) {
                plotData.setAxesForMeasurement(areaMeasure, null);
            } else {
                plotData.setAxesForMeasurement(areaMeasure, axesColl[axIdx]);
            }
            wpd.tree.refreshPreservingSelection(true);
        }
    }
};

wpd.measurement = (function() {
    var activeMode;

    function start(mode) {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        mode.init();
        wpd.sidebar.show(mode.sidebarId);
        wpd.graphicsWidget.setTool(new wpd.AddMeasurementTool(mode));
        wpd.graphicsWidget.setRepainter(new wpd.MeasurementRepainter(mode));
        wpd.graphicsWidget.forceHandlerRepaint();
        activeMode = mode;
    }

    function addItem() {
        wpd.graphicsWidget.setRepainter(new wpd.MeasurementRepainter(activeMode));
        wpd.graphicsWidget.setTool(new wpd.AddMeasurementTool(activeMode));
    }

    function deleteItem() {
        wpd.graphicsWidget.setRepainter(new wpd.MeasurementRepainter(activeMode));
        wpd.graphicsWidget.setTool(new wpd.DeleteMeasurementTool(activeMode));
    }

    function clearAll() {
        wpd.graphicsWidget.removeTool();
        wpd.graphicsWidget.resetData();
        activeMode.clear();
    }

    function changeAxes(axIdx) {
        activeMode.changeAxes(parseInt(axIdx, 10));
    }

    return {
        start: start,
        addItem: addItem,
        deleteItem: deleteItem,
        clearAll: clearAll,
        changeAxes: changeAxes
    };
})();/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.PageManager = class {
    constructor() {
        this.handle = null;
        this.curPage = 0;
        this.minPage = 0;
        this.maxPage = 0;
        this.customLabelsByPage = {};
        this.axesByPage = {};
        this.datasetsByPage = {};
        this.measurementsByPage = {};
        this.$pageSelector = document.getElementById('image-page-nav-select');
        this.$pageRelabelInput = document.getElementById('image-page-relabel-input');
        this.$pageRelabelAllCheckbox = document.getElementById('image-page-relabel-all-checkbox');
        this.$pageRelabelSetButton = document.getElementById('image-page-relabel-set-button');
        this.$pageRelabelDeleteButton = document.getElementById('image-page-relabel-delete-button');
        this.$pageRelabelDeleteAllButton = document.getElementById('image-page-relabel-delete-all-button');
    }

    init(handle, skipInputRefresh) {
        this.handle = handle;
        this.curPage = 1;
        this.minPage = 1;
        this.maxPage = this.pageCount();
        if (!skipInputRefresh) {
            this._initializeInput();
        }

        return this;
    }

    _initializeInput() {
        const values = wpd.utils.integerRange(this.maxPage, this.minPage);
        const selected = this.curPage;
        this.getPageLabels().then(fileLabels => {
            let labels = [];

            // loop through page range
            values.forEach(page => {
                const index = page - 1;
                let label = page;
                // priority of page labels:
                //   1. custom page labels
                //   2. file page labels
                //   3. page number
                if (this.customLabelsByPage.hasOwnProperty(page)) {
                    label = this.customLabelsByPage[page] + ' (page ' + page + ' within file)';
                } else if (fileLabels !== null) {
                    label = fileLabels[index] + ' (page ' + page + ' within file)';
                }
                labels.push(label);
            }, this);

            this.$pageSelector.innerHTML = wpd.utils.createOptionsHTML(labels, values, selected);
        });
    }

    refreshInput() {
        this._initializeInput();
        this._resetRelabelPopup();
    }

    validateLabel(label) {
        if (label !== '') {
            this.$pageRelabelSetButton.disabled = false;
            if (wpd.utils.isInteger(label)) {
                this.$pageRelabelAllCheckbox.disabled = false;
                this.$pageRelabelAllCheckbox.parentElement.style = 'color: black;';
            } else {
                this.$pageRelabelAllCheckbox.checked = false;
                this.$pageRelabelAllCheckbox.disabled = true;
                this.$pageRelabelAllCheckbox.parentElement.style = 'color: lightgray;';
            }
        } else {
            this.$pageRelabelSetButton.disabled = true;
        }
    }

    _resetRelabelPopup() {
        this.$pageRelabelInput.value = '';
        this.$pageRelabelAllCheckbox.checked = false;
        this.$pageRelabelAllCheckbox.disabled = true;
        this.$pageRelabelAllCheckbox.parentElement.style = 'color: lightgray;';
        this.$pageRelabelSetButton.disabled = true;
        if (Object.keys(this.customLabelsByPage).length) {
            this.$pageRelabelDeleteAllButton.disabled = false;
            if (this.customLabelsByPage.hasOwnProperty(this.curPage)) {
                this.$pageRelabelDeleteButton.disabled = false;
            } else {
                this.$pageRelabelDeleteButton.disabled = true;
            }
        } else {
            this.$pageRelabelDeleteButton.disabled = true;
            this.$pageRelabelDeleteAllButton.disabled = true;
        }
    }

    setLabel() {
        const newLabel = this.$pageRelabelInput.value;
        if (newLabel !== '') {
            if (this.$pageRelabelAllCheckbox.checked) {
                const pages = wpd.utils.integerRange(this.maxPage, this.minPage);
                const delta = newLabel - this.curPage;
                pages.forEach(page => this.customLabelsByPage[page] = page + delta, this);
            } else {
                this.customLabelsByPage[this.curPage] = newLabel;
            }
            this._initializeInput();
            wpd.popup.close('image-page-relabel-popup');
            this._resetRelabelPopup();
        }
    }

    deleteLabel(all) {
        if (all) {
            this.customLabelsByPage = {};
        } else {
            delete this.customLabelsByPage[this.curPage];
        }
        this._initializeInput();
        wpd.popup.close('image-page-relabel-popup');
        this._resetRelabelPopup();
    }

    get() {
        return this.handle;
    }

    getPage() {}

    pageCount() {
        return 0;
    }

    getPageLabels() {
        return new Promise(resolve => resolve(null));
    }

    currentPage() {
        return this.curPage;
    }

    previous() {
        this.switch(this.curPage - 1);
    }

    next() {
        this.switch(this.curPage + 1);
    }

    switch (pageNumber = 1) {
        wpd.busyNote.show();

        const parsedPageNumber = parseInt(pageNumber, 10);

        if (!this._validatePageNumber(parsedPageNumber)) {
            wpd.busyNote.close();
            wpd.messagePopup.show('Error', 'Invalid page number.');
            return false;
        }

        this.curPage = parsedPageNumber;

        // udpate select value for calls from other controls
        this.$pageSelector.value = parsedPageNumber;

        const axesPageMap = this.getAxesNameMap();
        const hasAxes = Object.keys(axesPageMap).some(name => axesPageMap[name] === parsedPageNumber);
        this.renderPage(parsedPageNumber, hasAxes);
        this._resetRelabelPopup();
    }

    _validatePageNumber(pageNumber) {
        return pageNumber >= this.minPage && pageNumber <= this.maxPage;
    }

    _pageRenderer(page, resumedProject, resolve, reject) {
        // implementation specific
    }

    renderPage(pageNumber, resumedProject) {
        return new Promise((resolve, reject) => {
            this.getPage(pageNumber).then(page => {
                this._pageRenderer(page, resumedProject, resolve, reject);
            });
        });
    }

    _getCurrentPageObjects(collection) {
        if (collection[this.curPage]) {
            return collection[this.curPage];
        }
        return [];
    }

    getCurrentPageAxes() {
        return this._getCurrentPageObjects(this.axesByPage);
    }

    getCurrentPageDatasets() {
        return this._getCurrentPageObjects(this.datasetsByPage);
    }

    addAxesToCurrentPage(axes) {
        wpd.utils.addToCollection(this.axesByPage, this.curPage, axes);
    }

    addDatasetsToCurrentPage(dataset) {
        wpd.utils.addToCollection(this.datasetsByPage, this.curPage, dataset);
    }

    addMeasurementsToCurrentPage(measurements) {
        wpd.utils.addToCollection(this.measurementsByPage, this.curPage, measurements);
    }

    deleteAxesFromCurrentPage(axes) {
        wpd.utils.deleteFromCollection(this.axesByPage, this.curPage, axes);
    }

    deleteDatasetsFromCurrentPage(datasets) {
        wpd.utils.deleteFromCollection(this.datasetsByPage, this.curPage, datasets);
    }

    deleteMeasurementsFromCurrentPage(measurements) {
        wpd.utils.deleteFromCollection(this.measurementsByPage, this.curPage, measurements);
    }

    getAxesNameMap() {
        return wpd.utils.invertObject(this.axesByPage);
    }

    getDatasetNameMap() {
        return wpd.utils.invertObject(this.datasetsByPage);
    }

    filterToCurrentPageAxes(axes) {
        return wpd.utils.filterCollection(this.axesByPage, this.curPage, axes);
    }

    filterToCurrentPageDatasets(datasets) {
        return wpd.utils.filterCollection(this.datasetsByPage, this.curPage, datasets);
    }

    filterToCurrentPageMeasurements(measurements) {
        return wpd.utils.filterCollection(this.measurementsByPage, this.curPage, measurements);
    }

    getMeasurementPageMap() {
        return this.measurementsByPage;
    }

    getPageLabelMap() {
        return this.customLabelsByPage;
    }

    loadPageData(data) {
        this.axesByPage = data.axes || {};
        this.datasetsByPage = data.datasets || {};
        this.measurementsByPage = data.measurements || {};
        this.customLabelsByPage = data.pageLabels || {};
    }
};

wpd.PDFManager = class extends wpd.PageManager {
    getPage(pageNumber) {
        return this.handle.getPage(pageNumber);
    }

    getPageLabels() {
        return this.handle.getPageLabels();
    }

    pageCount() {
        return this.handle.numPages;
    }

    _pageRenderer(page, resumedProject, resolve, reject) {
        let scale = 3;
        let viewport = page.getViewport({
            scale: scale
        });
        let $canvas = document.createElement('canvas');
        let ctx = $canvas.getContext('2d');
        $canvas.width = viewport.width;
        $canvas.height = viewport.height;
        page.render({
                canvasContext: ctx,
                viewport: viewport
            })
            .promise.then(
                function() {
                    let url = $canvas.toDataURL();
                    wpd.imageManager.loadFromURL(url, resumedProject).then(resolve);
                },
                function(err) {
                    console.log(err);
                    wpd.busyNote.close();
                    reject(err);
                });
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.UndoManager = class {
    constructor() {
        this._actions = [];
        this._actionIndex = 0;
    }

    canUndo() {
        return this._actionIndex > 0 && this._actions.length >= this._actionIndex;
    }

    undo() {
        if (!this.canUndo()) {
            return;
        }
        this._actionIndex--;
        let action = this._actions[this._actionIndex];
        action.undo();
        this.updateUI();
    }

    canRedo() {
        return this._actions.length > this._actionIndex;
    }

    redo() {
        if (!this.canRedo()) {
            return;
        }
        let action = this._actions[this._actionIndex];
        action.execute();
        this._actionIndex++;
        this.updateUI();
    }

    reapply() {
        if (!this.canUndo()) {
            return;
        }
        for (let i = 0; i < this._actionIndex; i++) {
            let action = this._actions[i];
            action.execute();
        }
        this.updateUI();
    }

    insertAction(action) {
        if (!(action instanceof wpd.ReversibleAction)) {
            console.error("action must be a wpd.ReversibleAction!");
            return;
        }
        if (this.canRedo()) {
            // drop all possible future actions
            this._actions.length = this._actionIndex;
        }
        this._actions.push(action);
        this._actionIndex++;
        this.updateUI();
    }

    clear() {
        this._actions = [];
        this._actionIndex = 0;
        this.updateUI();
    }

    updateUI() {
        // enable/disable undo and redo buttons
        const $undo = document.getElementById("image-editing-undo");
        const $redo = document.getElementById("image-editing-redo");

        if (this.canUndo()) {
            $undo.disabled = false;
        } else {
            $undo.disabled = true;
        }

        if (this.canRedo()) {
            $redo.disabled = false;
        } else {
            $redo.disabled = true;
        }
    }
};/*
    WebPlotDigitizer - https://automeris.io/WebPlotDigitizer

    Copyright 2010-2021 Ankit Rohatgi <ankitrohatgi@hotmail.com>

    This file is part of WebPlotDigitizer.

    WebPlotDigitizer is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    WebPlotDigitizer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with WebPlotDigitizer.  If not, see <http://www.gnu.org/licenses/>.
*/

var wpd = wpd || {};

wpd.utils = (function() {
    function toggleElementsDisplay(elements, hide) {
        for (const $el of elements) $el.hidden = hide;
    }

    function addToCollection(collection, key, objects) {
        if (!collection[key]) {
            collection[key] = [];
        }
        Array.prototype.push.apply(collection[key], objects);
    }

    function deleteFromCollection(collection, key, objects) {
        if (!collection[key]) return;
        objects.forEach(object => {
            const index = collection[key].indexOf(object);
            if (index > -1) {
                collection[key].splice(index, 1);
            }
        });
    }

    function invertObject(object) {
        let map = {};
        Object.entries(object).forEach(([index, collection]) => {
            collection.forEach(item => map[item.name] = parseInt(index, 10));
        });
        return map;
    }

    function filterCollection(collection, key, objects) {
        let filtered = [];
        if (collection[key]) {
            filtered = objects.filter(object => {
                return collection[key].indexOf(object) > -1;
            });
        }
        return filtered;
    }

    function findKey(collection, object) {
        for (const key in collection) {
            if (collection[key].indexOf(object) > -1) {
                return parseInt(key, 10);
            }
        }
    }

    function createOptionsHTML(labels, values, selectedValue) {
        if (labels.length !== values.length) {
            console.error('labels and values length mismatch');
        }

        let optionsHTML = '';
        for (let i = 0; i < labels.length; i++) {
            optionsHTML += '<option value="' + values[i] + '"';
            if (values[i] === selectedValue) optionsHTML += ' selected';
            optionsHTML += '>' + labels[i] + '</option>';
        }
        return optionsHTML;
    }

    function integerRange(count, start = 0) {
        return Array.apply(null, Array(count)).map((_, i) => i + start);
    }

    function isInteger(value) {
        return /^-?[1-9]\d*$|^0$/.test(value);
    }

    function toSentenceCase(string) {
        return string.charAt(0).toUpperCase() + string.substr(1).toLowerCase();
    }

    return {
        addToCollection: addToCollection,
        createOptionsHTML: createOptionsHTML,
        deleteFromCollection: deleteFromCollection,
        filterCollection: filterCollection,
        findKey: findKey,
        integerRange: integerRange,
        invertObject: invertObject,
        isInteger: isInteger,
        toggleElementsDisplay: toggleElementsDisplay,
        toSentenceCase: toSentenceCase
    };
})();