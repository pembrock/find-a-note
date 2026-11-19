export namespace midi {
	
	export class Device {
	    id: string;
	    name: string;
	    identity: string;
	
	    static createFrom(source: any = {}) {
	        return new Device(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.identity = source["identity"];
	    }
	}
	export class State {
	    devices: Device[];
	    selected?: Device;
	    status: string;
	    message: string;
	    session: string;
	    revision: number;
	
	    static createFrom(source: any = {}) {
	        return new State(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.devices = this.convertValues(source["devices"], Device);
	        this.selected = this.convertValues(source["selected"], Device);
	        this.status = source["status"];
	        this.message = source["message"];
	        this.session = source["session"];
	        this.revision = source["revision"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

